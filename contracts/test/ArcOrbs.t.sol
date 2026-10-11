// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ArcOrbs} from "../src/ArcOrbs.sol";

/// ArcOrbs with the wallet check replaced by a list, so the game's own rules are
/// tested without Safe's contracts. The real check is tested in VelaWallet.t.sol
/// and, against Arc, in LuckyFork.t.sol.
contract ArcOrbsHarness is ArcOrbs {
    mapping(address => bool) public vela;

    function setVela(address account, bool yes) external {
        vela[account] = yes;
    }

    function isVelaWallet(address account) public view override returns (bool) {
        return vela[account];
    }
}

contract RejectsPayment {
    function draw(ArcOrbs orbs, uint256 id) external {
        orbs.draw(id);
    }
}

contract ArcOrbsTest is Test {
    ArcOrbsHarness orbs;
    address creator = makeAddr("creator");

    uint256 constant CENT = 0.01 ether;

    function setUp() public {
        orbs = new ArcOrbsHarness();
        orbs.setVela(creator, true);
        vm.deal(creator, 1_000_000 ether);
    }

    function _player(uint256 i) internal returns (address player) {
        player = address(uint160(0x1000 + i));
        orbs.setVela(player, true);
    }

    function _create(uint256 pool, uint32 prizes) internal returns (uint256 id) {
        vm.prank(creator);
        id = orbs.create{value: pool}(prizes, 1 days, "gm");
    }

    function test_create_storesTheDrop() public {
        vm.expectEmit();
        emit ArcOrbs.DropCreated(0, creator, 10 ether, 5, uint64(block.timestamp + 1 days), "gm");
        uint256 id = _create(10 ether, 5);

        ArcOrbs.Drop memory drop = orbs.getDrop(id);
        assertEq(drop.creator, creator);
        assertEq(drop.pool, 10 ether);
        assertEq(drop.remaining, 10 ether);
        assertEq(drop.prizes, 5);
        assertEq(drop.drawn, 0);
        assertEq(drop.expiresAt, block.timestamp + 1 days);
        assertEq(drop.note, "gm");
        assertEq(orbs.dropCount(), 1);
        assertEq(address(orbs).balance, 10 ether);
    }

    function test_create_onlyVela() public {
        address stranger = makeAddr("stranger");
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(ArcOrbs.NotVelaWallet.selector);
        orbs.create{value: 1 ether}(1, 1 days, "");
    }

    function test_create_rejectsBadInput() public {
        vm.startPrank(creator);
        vm.expectRevert(ArcOrbs.BadPrizeCount.selector);
        orbs.create{value: 1 ether}(0, 1 days, "");

        vm.expectRevert(ArcOrbs.BadPool.selector);
        orbs.create{value: 10 * CENT - 1}(10, 1 days, "");

        vm.expectRevert(ArcOrbs.BadDuration.selector);
        orbs.create{value: 1 ether}(1, 10 minutes - 1, "");

        vm.expectRevert(ArcOrbs.BadDuration.selector);
        orbs.create{value: 1 ether}(1, 30 days + 1, "");

        vm.expectRevert(ArcOrbs.NoteTooLong.selector);
        orbs.create{value: 1 ether}(
            1, 1 days, "123456789012345678901234567890123456789012345678901234567890123456789012345678901"
        );
        vm.stopPrank();
    }

    function test_draw_paysThePlayerAtOnce() public {
        uint256 id = _create(10 ether, 5);
        address player = _player(0);

        vm.prank(player);
        uint256 amount = orbs.draw(id);

        assertGe(amount, CENT);
        assertEq(player.balance, amount);
        assertEq(orbs.prizeOf(id, player), amount);
        ArcOrbs.Drop memory drop = orbs.getDrop(id);
        assertEq(drop.remaining, 10 ether - amount);
        assertEq(drop.drawn, 1);
        assertEq(drop.luckiest, player);
        assertEq(drop.best, amount);
    }

    function test_draw_onlyVela() public {
        uint256 id = _create(10 ether, 5);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ArcOrbs.NotVelaWallet.selector);
        orbs.draw(id);
    }

    function test_draw_oncePerAccount() public {
        uint256 id = _create(10 ether, 5);
        address player = _player(0);
        vm.startPrank(player);
        orbs.draw(id);
        vm.expectRevert(ArcOrbs.AlreadyDrawn.selector);
        orbs.draw(id);
        vm.stopPrank();
    }

    function test_draw_sameAccountMayDrawFromAnotherDrop() public {
        uint256 first = _create(10 ether, 5);
        uint256 second = _create(10 ether, 5);
        address player = _player(0);
        vm.startPrank(player);
        orbs.draw(first);
        orbs.draw(second);
        vm.stopPrank();
        assertGt(orbs.prizeOf(second, player), 0);
    }

    function test_draw_rejectsMissingExpiredAndEmptyDrops() public {
        address player = _player(0);
        vm.prank(player);
        vm.expectRevert(ArcOrbs.NoSuchDrop.selector);
        orbs.draw(0);

        uint256 id = _create(1 ether, 1);
        vm.prank(player);
        orbs.draw(id);
        vm.prank(_player(1));
        vm.expectRevert(ArcOrbs.DropEmpty.selector);
        orbs.draw(id);

        uint256 late = _create(1 ether, 2);
        skip(1 days);
        vm.prank(player);
        vm.expectRevert(ArcOrbs.DropExpired.selector);
        orbs.draw(late);
    }

    function test_draw_revertsWhenThePlayerCannotBePaid() public {
        uint256 id = _create(1 ether, 2);
        RejectsPayment player = new RejectsPayment();
        orbs.setVela(address(player), true);
        vm.expectRevert(ArcOrbs.TransferFailed.selector);
        player.draw(orbs, id);
    }

    /// Whatever the pool and however it is split, every draw pays at least a
    /// cent and leaves a cent for each draw still to come, and the last draw
    /// empties the drop exactly.
    function testFuzz_draw_splitsTheWholePool(uint96 pool, uint8 prizeCount, uint256 seed) public {
        uint32 prizes = uint32(bound(prizeCount, 1, 60));
        pool = uint96(bound(pool, prizes * CENT, 1_000_000 ether));
        vm.roll(bound(seed, 2, 1e9));
        uint256 id = _create(pool, prizes);

        uint256 paid;
        uint256 best;
        for (uint256 i = 0; i < prizes; i++) {
            address player = _player(i);
            uint256 remaining = pool - paid;
            uint256 left = prizes - i;

            vm.roll(block.number + 1);
            vm.prank(player);
            uint256 amount = orbs.draw(id);

            assertGe(amount, CENT);
            assertGe(remaining - amount, (left - 1) * CENT);
            assertEq(player.balance, amount);
            paid += amount;
            if (amount > best) best = amount;
        }

        assertEq(paid, pool);
        assertEq(address(orbs).balance, 0);
        ArcOrbs.Drop memory drop = orbs.getDrop(id);
        assertEq(drop.remaining, 0);
        assertEq(drop.drawn, prizes);
        assertEq(drop.best, best);
        assertEq(orbs.prizeOf(id, drop.luckiest), best);
    }

    /// Two draws in one block by different accounts must not be forced to the
    /// same number, and the prizes of a drop should not all be alike.
    function test_draw_prizesVary() public {
        uint256 id = _create(100 ether, 20);
        uint256 distinct;
        uint256 previous;
        for (uint256 i = 0; i < 19; i++) {
            vm.prank(_player(i));
            uint256 amount = orbs.draw(id);
            if (amount != previous) distinct++;
            previous = amount;
        }
        assertGt(distinct, 15);
    }

    /// The first of 20 draws is the share `1 - u^(1/19)` of what is in play:
    /// an even share on average, under a quarter of one a fifth of the time,
    /// and over three shares about once in twenty-two.
    function test_draw_firstDrawsHaveTheShapeOfARandomCut() public {
        uint256 draws = 2000;
        uint256 share = (10 ether - 20 * CENT) / 20;
        uint256 total;
        uint256 underAQuarter;
        uint256 overThree;
        uint256 previous;

        for (uint256 i = 0; i < draws; i++) {
            uint256 id = _create(10 ether, 20);
            vm.roll(block.number + 1);
            vm.prank(_player(i));
            uint256 cut = orbs.draw(id) - CENT;

            assertNotEq(cut, previous);
            previous = cut;
            total += cut;
            if (cut * 4 < share) underAQuarter++;
            if (cut > 3 * share) overThree++;
        }

        // Each bound is about four standard deviations from what is expected.
        assertApproxEqRel(total / draws, share, 0.09e18, "the average draw is not an even share");
        assertApproxEqAbs(underAQuarter, draws * 213 / 1000, 75, "draws under a quarter of a share");
        assertApproxEqAbs(overThree, draws * 46 / 1000, 38, "draws over three shares");
    }

    /// No place in the queue is better than another. Over many drops, every
    /// place is paid an even share on average, and holds the drop's largest
    /// prize as often as any other place does.
    function test_draw_everyPlaceInTheQueueHasTheSameOdds() public {
        uint256 drops = 800;
        uint256 prizes = 8;
        uint256[] memory paid = new uint256[](prizes);
        uint256[] memory luckiest = new uint256[](prizes);

        for (uint256 d = 0; d < drops; d++) {
            uint256 id = _create(8 ether, uint32(prizes));
            uint256 best;
            uint256 bestPlace;
            for (uint256 place = 0; place < prizes; place++) {
                vm.roll(block.number + 1);
                vm.prank(_player(d * prizes + place));
                uint256 amount = orbs.draw(id);
                paid[place] += amount;
                if (amount > best) (best, bestPlace) = (amount, place);
            }
            luckiest[bestPlace]++;
        }

        // 100 of the 800 largest prizes are expected in each place; 60 to 140 is
        // over four standard deviations either way. Sizing draws against the
        // running average puts about 180 in the last place.
        for (uint256 place = 0; place < prizes; place++) {
            assertApproxEqRel(paid[place] / drops, 1 ether, 0.15e18, "a place in the queue is paid more or less");
            assertApproxEqAbs(luckiest[place], drops / prizes, 40, "a place in the queue is luckier or unluckier");
        }
    }

    function test_website() public view {
        assertEq(orbs.WEBSITE(), "https://arcorbs.game3.app");
    }

    function test_refund_returnsWhatIsLeftAfterExpiry() public {
        uint256 id = _create(10 ether, 5);
        vm.prank(_player(0));
        uint256 drawn = orbs.draw(id);

        vm.prank(creator);
        vm.expectRevert(ArcOrbs.NotExpiredYet.selector);
        orbs.refund(id);

        skip(1 days);
        vm.prank(_player(1));
        vm.expectRevert(ArcOrbs.NotCreator.selector);
        orbs.refund(id);

        uint256 before = creator.balance;
        vm.expectEmit();
        emit ArcOrbs.Refunded(id, creator, 10 ether - drawn);
        vm.prank(creator);
        orbs.refund(id);
        assertEq(creator.balance - before, 10 ether - drawn);
        assertEq(orbs.getDrop(id).remaining, 0);
        assertEq(address(orbs).balance, 0);

        vm.prank(creator);
        vm.expectRevert(ArcOrbs.NothingToRefund.selector);
        orbs.refund(id);
    }

    function test_refund_doesNotTouchOtherDrops() public {
        uint256 first = _create(10 ether, 5);
        _create(7 ether, 5);
        skip(1 days);
        vm.prank(creator);
        orbs.refund(first);
        assertEq(address(orbs).balance, 7 ether);
    }

    function test_getDrops_pagesNewestFirst() public {
        for (uint256 i = 0; i < 5; i++) {
            _create((i + 1) * 1 ether, 1);
        }
        (ArcOrbs.Drop[] memory page, uint256 total) = orbs.getDrops(0, 2);
        assertEq(total, 5);
        assertEq(page.length, 2);
        assertEq(page[0].pool, 5 ether);
        assertEq(page[1].pool, 4 ether);

        (page,) = orbs.getDrops(3, 10);
        assertEq(page.length, 2);
        assertEq(page[0].pool, 2 ether);
        assertEq(page[1].pool, 1 ether);

        (page,) = orbs.getDrops(5, 10);
        assertEq(page.length, 0);
        (page, total) = orbs.getDrops(0, 0);
        assertEq(page.length, 0);
        assertEq(total, 5);
    }

    function test_getDraws_pagesNewestFirst() public {
        uint256 id = _create(10 ether, 5);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(_player(i));
            orbs.draw(id);
        }
        assertEq(orbs.drawCount(id), 3);

        ArcOrbs.Draw[] memory page = orbs.getDraws(id, 0, 2);
        assertEq(page.length, 2);
        assertEq(page[0].player, _player(2));
        assertEq(page[0].amount, orbs.prizeOf(id, _player(2)));
        assertEq(page[1].player, _player(1));

        page = orbs.getDraws(id, 2, 10);
        assertEq(page.length, 1);
        assertEq(page[0].player, _player(0));
        assertEq(orbs.getDraws(id, 3, 10).length, 0);
    }
}
