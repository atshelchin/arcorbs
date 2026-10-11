// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ArcOrbs} from "../src/ArcOrbs.sol";
import {VelaWallet} from "../src/VelaWallet.sol";

interface ISafeProxyFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
    function proxyCreationCode() external pure returns (bytes memory);
}

interface ISignerFactory {
    function getSigner(uint256 x, uint256 y, uint176 verifiers) external view returns (address);
}

interface ISafeAdmin {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;
    function addOwnerWithThreshold(address owner, uint256 threshold) external;
    function getOwners() external view returns (address[] memory);
    function isModuleEnabled(address module) external view returns (bool);
}

/// The wallet check against the contracts Vela really uses, on a fork of Arc.
/// Skipped unless ARC_RPC_URL is set:
///
///     ARC_RPC_URL=https://rpc.testnet.arc.network forge test --match-contract ArcOrbsForkTest
contract ArcOrbsForkTest is Test {
    ISafeProxyFactory constant FACTORY = ISafeProxyFactory(VelaWallet.SAFE_PROXY_FACTORY);

    ArcOrbs orbs;

    function setUp() public {
        string memory url = vm.envOr("ARC_RPC_URL", string(""));
        if (bytes(url).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(url);
        orbs = new ArcOrbs();
    }

    function _keys(uint256 count, uint256 seed) internal pure returns (uint256[] memory keys) {
        keys = new uint256[](count * 2);
        for (uint256 i = 0; i < count; i++) {
            // Ascending x, as Vela orders every key after the first.
            keys[i * 2] = (seed << 16) + i + 1;
            keys[i * 2 + 1] = uint256(keccak256(abi.encode(seed, i)));
        }
    }

    /// Deploys a wallet exactly as Vela's first user operation does.
    function _found(uint256[] memory keys) internal returns (address safe) {
        safe = FACTORY.createProxyWithNonce(
            VelaWallet.SAFE_SINGLETON, VelaWallet.setupData(keys), uint256(keccak256(abi.encodePacked(keys)))
        );
        assertEq(safe, VelaWallet.predict(keys));
    }

    function test_constantsMatchTheDeployedContracts() public view {
        assertEq(
            keccak256(abi.encodePacked(FACTORY.proxyCreationCode(), uint256(uint160(VelaWallet.SAFE_SINGLETON)))),
            VelaWallet.PROXY_INIT_CODE_HASH
        );
        assertEq(
            ISignerFactory(VelaWallet.SIGNER_FACTORY).getSigner(7, 9, uint176(VelaWallet.VERIFIERS)),
            VelaWallet.signerAddress(7, 9)
        );
    }

    function test_isVelaWallet_acceptsEveryKeyCount() public {
        for (uint256 count = 1; count <= VelaWallet.MAX_KEYS; count++) {
            address safe = _found(_keys(count, count));
            assertEq(safe.codehash, VelaWallet.PROXY_RUNTIME_CODEHASH);
            assertEq(ISafeAdmin(safe).getOwners().length, count);
            assertTrue(ISafeAdmin(safe).isModuleEnabled(VelaWallet.SAFE_4337_MODULE));
            assertTrue(orbs.isVelaWallet(safe), "a Vela wallet was refused");
        }
    }

    function test_isVelaWallet_rejectsTheSameSetupUnderAnotherSalt() public {
        uint256[] memory keys = _keys(2, 42);
        address safe = FACTORY.createProxyWithNonce(VelaWallet.SAFE_SINGLETON, VelaWallet.setupData(keys), 42);
        assertFalse(orbs.isVelaWallet(safe));
    }

    function test_isVelaWallet_rejectsAnOrdinarySafe() public {
        address[] memory owners = new address[](1);
        owners[0] = makeAddr("owner");
        bytes memory setup =
            abi.encodeCall(ISafeAdmin.setup, (owners, 1, address(0), "", address(0), address(0), 0, payable(0)));
        address safe = FACTORY.createProxyWithNonce(VelaWallet.SAFE_SINGLETON, setup, 1);
        assertFalse(orbs.isVelaWallet(safe));
    }

    function test_isVelaWallet_rejectsAWalletThatGainedAnOwner() public {
        address safe = _found(_keys(1, 77));
        assertTrue(orbs.isVelaWallet(safe));
        vm.prank(safe);
        ISafeAdmin(safe).addOwnerWithThreshold(makeAddr("bot"), 1);
        assertFalse(orbs.isVelaWallet(safe));
    }

    function test_isVelaWallet_rejectsOtherAccounts() public {
        assertFalse(orbs.isVelaWallet(makeAddr("eoa")));
        assertFalse(orbs.isVelaWallet(address(this)));
        assertFalse(orbs.isVelaWallet(VelaWallet.SAFE_SINGLETON));
        assertFalse(orbs.isVelaWallet(VelaWallet.SHARED_SIGNER));
    }

    function test_onlyVelaWalletsCreateAndDraw() public {
        address creator = _found(_keys(1, 1001));
        address player = _found(_keys(3, 1002));
        address stranger = makeAddr("stranger");
        vm.deal(creator, 10 ether);
        vm.deal(stranger, 10 ether);

        vm.prank(stranger);
        vm.expectRevert(ArcOrbs.NotVelaWallet.selector);
        orbs.create{value: 5 ether}(5, 1 days, "");

        vm.prank(creator);
        uint256 id = orbs.create{value: 5 ether}(5, 1 days, "welcome aboard");

        vm.prank(stranger);
        vm.expectRevert(ArcOrbs.NotVelaWallet.selector);
        orbs.draw(id);

        uint256 before = player.balance;
        vm.prank(player);
        uint256 amount = orbs.draw(id);
        assertEq(player.balance - before, amount);
        assertGe(amount, orbs.MIN_PRIZE());
    }
}
