// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {VelaWallet} from "./VelaWallet.sol";

/// @notice Arc Orbs: drops of USDC on Arc, for Vela Wallet accounts only.
///
/// Anyone with a Vela account funds a drop with USDC — Arc's native coin — and
/// splits it into a number of prizes. Every Vela account may draw once per
/// drop, and is paid its prize in the same transaction.
///
/// Prize sizes are random, and random in the same way for everyone: a drop is
/// cut as a length is cut at random points, so the first draw, the last and
/// every one between have the same odds of a large prize or a small one.
/// Nobody leaves with less than a cent, and the last draw empties the drop.
///
/// The randomness is good for a game, not for a casino: Arc's `prevrandao` is
/// always zero, so a draw is seeded from the previous block hash and from
/// every draw this contract has ever paid.
contract ArcOrbs {
    struct Drop {
        address creator;
        uint64 expiresAt;
        uint32 prizes;
        uint96 pool;
        uint96 remaining;
        uint32 drawn;
        address luckiest;
        uint96 best;
        string note;
    }

    struct Draw {
        address player;
        uint96 amount;
    }

    /// Where the game is played. A contract cannot be changed, so neither can
    /// this: it holds for as long as the address is the game's.
    string public constant WEBSITE = "https://arcorbs.game3.app";

    /// One cent of Arc's 18-decimal USDC: the least any draw pays.
    uint256 public constant MIN_PRIZE = 0.01 ether;
    uint256 public constant MIN_DURATION = 10 minutes;
    uint256 public constant MAX_DURATION = 30 days;
    uint256 public constant MAX_NOTE_LENGTH = 80;

    Drop[] private _drops;
    mapping(uint256 id => Draw[]) private _draws;
    /// What an account drew from a drop. Zero means it has not drawn.
    mapping(uint256 id => mapping(address player => uint256)) public prizeOf;
    bytes32 private _entropy;

    event DropCreated(
        uint256 indexed id, address indexed creator, uint256 pool, uint32 prizes, uint64 expiresAt, string note
    );
    event Drawn(uint256 indexed id, address indexed player, uint256 amount, uint32 left);
    event Refunded(uint256 indexed id, address indexed creator, uint256 amount);

    error NotVelaWallet();
    error NoSuchDrop();
    error BadPrizeCount();
    error BadPool();
    error BadDuration();
    error NoteTooLong();
    error DropExpired();
    error DropEmpty();
    error AlreadyDrawn();
    error NotCreator();
    error NotExpiredYet();
    error NothingToRefund();
    error TransferFailed();

    modifier onlyVela() {
        if (!isVelaWallet(msg.sender)) revert NotVelaWallet();
        _;
    }

    /// @notice Funds a drop with the USDC sent along.
    /// @param prizes How many accounts can draw.
    /// @param duration Seconds until the drop closes and what is left can be refunded.
    function create(uint32 prizes, uint256 duration, string calldata note)
        external
        payable
        onlyVela
        returns (uint256 id)
    {
        if (prizes == 0) revert BadPrizeCount();
        if (msg.value < prizes * MIN_PRIZE || msg.value > type(uint96).max) revert BadPool();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert BadDuration();
        if (bytes(note).length > MAX_NOTE_LENGTH) revert NoteTooLong();

        id = _drops.length;
        uint64 expiresAt = uint64(block.timestamp + duration);
        _drops.push(
            Drop({
                creator: msg.sender,
                expiresAt: expiresAt,
                prizes: prizes,
                pool: uint96(msg.value),
                remaining: uint96(msg.value),
                drawn: 0,
                luckiest: address(0),
                best: 0,
                note: note
            })
        );
        emit DropCreated(id, msg.sender, msg.value, prizes, expiresAt, note);
    }

    /// @notice Draws the caller's prize from a drop and pays it.
    function draw(uint256 id) external onlyVela returns (uint256 amount) {
        Drop storage drop = _drop(id);
        if (block.timestamp >= drop.expiresAt) revert DropExpired();
        uint256 left = drop.prizes - drop.drawn;
        if (left == 0) revert DropEmpty();
        if (prizeOf[id][msg.sender] != 0) revert AlreadyDrawn();

        uint256 remaining = drop.remaining;
        if (left == 1) {
            amount = remaining;
        } else {
            // Every prize still to come is owed its cent; the rest is in play.
            amount = MIN_PRIZE + _cut(remaining - left * MIN_PRIZE, left, _random(id));
        }

        // Nothing here can outgrow its type: an amount is part of a pool that fits 96 bits.
        drop.remaining = uint96(remaining - amount);
        drop.drawn += 1;
        if (amount > drop.best) {
            drop.best = uint96(amount);
            drop.luckiest = msg.sender;
        }
        prizeOf[id][msg.sender] = amount;
        _draws[id].push(Draw(msg.sender, uint96(amount)));
        emit Drawn(id, msg.sender, amount, uint32(left - 1));

        _pay(msg.sender, amount);
    }

    /// @notice Returns what nobody drew to the creator, once the drop has closed.
    function refund(uint256 id) external {
        Drop storage drop = _drop(id);
        if (msg.sender != drop.creator) revert NotCreator();
        if (block.timestamp < drop.expiresAt) revert NotExpiredYet();
        uint256 amount = drop.remaining;
        if (amount == 0) revert NothingToRefund();

        drop.remaining = 0;
        emit Refunded(id, msg.sender, amount);
        _pay(msg.sender, amount);
    }

    function isVelaWallet(address account) public view virtual returns (bool) {
        return VelaWallet.isVelaWallet(account);
    }

    function dropCount() external view returns (uint256) {
        return _drops.length;
    }

    function getDrop(uint256 id) external view returns (Drop memory) {
        return _drop(id);
    }

    /// @notice A page of drops, newest first: `page[i]` is drop `total - 1 - offset - i`.
    function getDrops(uint256 offset, uint256 limit) external view returns (Drop[] memory page, uint256 total) {
        total = _drops.length;
        uint256 size = _pageSize(total, offset, limit);
        page = new Drop[](size);
        for (uint256 i = 0; i < size; i++) {
            page[i] = _drops[total - 1 - offset - i];
        }
    }

    function drawCount(uint256 id) external view returns (uint256) {
        return _draws[id].length;
    }

    /// @notice A page of a drop's draws, newest first.
    function getDraws(uint256 id, uint256 offset, uint256 limit) external view returns (Draw[] memory page) {
        Draw[] storage draws = _draws[id];
        uint256 total = draws.length;
        uint256 size = _pageSize(total, offset, limit);
        page = new Draw[](size);
        for (uint256 i = 0; i < size; i++) {
            page[i] = draws[total - 1 - offset - i];
        }
    }

    function _drop(uint256 id) private view returns (Drop storage) {
        if (id >= _drops.length) revert NoSuchDrop();
        return _drops[id];
    }

    function _pageSize(uint256 total, uint256 offset, uint256 limit) private pure returns (uint256) {
        if (offset >= total) return 0;
        uint256 available = total - offset;
        return limit < available ? limit : available;
    }

    /// @notice A random cut of `inPlay`, for one of the `left` draws still to come.
    ///
    /// Cut a length at `left - 1` random points and its first piece is the
    /// share `1 - u^(1 / (left - 1))` of the whole, for u uniform in (0, 1].
    /// Taking that share of what is left, draw after draw, cuts the whole drop
    /// that way, and the pieces of such a cut are alike in every respect: no
    /// place in the queue has better odds than another, of a large prize or of
    /// a small one. A share sized against the running average, the usual way
    /// to split a red packet, favours whoever draws last.
    function _cut(uint256 inPlay, uint256 left, uint256 random) private pure returns (uint256) {
        int256 u = int256(random % 1e18) + 1;
        // u^(1 / (left - 1)) as exp(ln(u) / (left - 1)), in 18 decimals.
        int256 kept = FixedPointMathLib.expWad(FixedPointMathLib.lnWad(u) / int256(left - 1));
        // The exponent is never positive, so `kept` is at most 1 — give or
        // take the library's last digit, which must not be what reverts a draw.
        return kept >= 1e18 ? 0 : inPlay * uint256(1e18 - kept) / 1e18;
    }

    function _random(uint256 id) private returns (uint256 value) {
        value = uint256(keccak256(abi.encode(_entropy, blockhash(block.number - 1), block.timestamp, msg.sender, id)));
        _entropy = bytes32(value);
    }

    function _pay(address to, uint256 amount) private {
        (bool sent,) = to.call{value: amount}("");
        if (!sent) revert TransferFailed();
    }
}
