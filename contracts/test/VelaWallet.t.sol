// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VelaWallet} from "../src/VelaWallet.sol";

/// The expected values are vela-core's own (`rust/crates/vela-core/src/safe.rs`
/// tests): if these pass, this library derives the address the wallet derives.
contract VelaWalletTest is Test {
    uint256 constant AX = 0x8f9b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0;
    uint256 constant AY = 0x7a8b9cadbecfd0e1f20314253647586970818293a4b5c6d7e8f9010203040506;
    uint256 constant BX = 1;
    uint256 constant BY = 2;
    uint256 constant CX = 0x04d2163f5c2c9a5a3f0e1d2c3b4a59687766554433221100ffeeddccbbaa9988;
    uint256 constant CY = 0x1122334455667788990a0b0c0d0e0f102132435465768798a9bacbdcedfe0f21;

    function test_signerAddress() public pure {
        assertEq(VelaWallet.signerAddress(BX, BY), 0xE03432AB61033B62072aE0CCAb7550C731955De7);
        assertEq(VelaWallet.signerAddress(AX, AY), 0xEBc27e114a6386c331098F1d1d6B53555c1DD5C7);
        assertEq(VelaWallet.signerAddress(CX, CY), 0xfD26982E29A3C9378fA9e39795529021Dcc72fdC);
    }

    function test_predict_oneKey() public pure {
        uint256[] memory keys = new uint256[](2);
        keys[0] = 0xa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90;
        keys[1] = 0xb1c2d3e4f50617283940a1b2c3d4e5f6b1c2d3e4f50617283940a1b2c3d4e5f6;
        assertEq(VelaWallet.predict(keys), 0x762EdA60D3B68755c271D608644650278f88329F);
    }

    function test_predict_twoKeys() public pure {
        uint256[] memory keys = new uint256[](4);
        (keys[0], keys[1], keys[2], keys[3]) = (AX, AY, CX, CY);
        assertEq(VelaWallet.predict(keys), 0xaBeF0bf37A03a2Af821Cf409a52eB9C01524b2E0);
    }

    function test_predict_threeKeys() public pure {
        uint256[] memory keys = new uint256[](6);
        (keys[0], keys[1], keys[2], keys[3], keys[4], keys[5]) = (AX, AY, BX, BY, CX, CY);

        bytes memory setup = VelaWallet.setupData(keys);
        assertEq(setup.length, 1284);
        assertEq(keccak256(setup), 0x7e1d099d46166dff8b1ad992a8cb4b0cf834bc7c6c2253b1f8289fffd1797088);
        assertEq(keccak256(abi.encodePacked(keys)), 0x66c406059aeec0effec5c28a2e3accc5f3fe0553c94afb643e3a33fc4aaab313);
        assertEq(VelaWallet.predict(keys), 0x5AF6Cd8689C013192e157826f7C4574d7C2f9446);
    }

    function test_predict_keysSharingX() public pure {
        uint256 x = 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;
        uint256[] memory keys = new uint256[](6);
        (keys[0], keys[1], keys[2], keys[3], keys[4], keys[5]) = (AX, AY, x, 1, x, 2);
        assertEq(VelaWallet.predict(keys), 0x689FaD35F595204ea5cB82cfa80046A45a81288D);
    }

    function test_predict_sevenKeys() public pure {
        uint256[] memory keys = new uint256[](14);
        for (uint256 i = 0; i < 7; i++) {
            keys[i * 2] = i;
            keys[i * 2 + 1] = (1 << 248) + i;
        }
        assertEq(
            keccak256(VelaWallet.setupData(keys)), 0x6a24ad2f51afa8858b15982512e94743a5c594a0f96e9d9210b5010ae360cfd0
        );
        assertEq(VelaWallet.predict(keys), 0xc94f9367f7DD7cd5c8e790b59356093Bc6AA0365);
    }

    function test_isVelaWallet_rejectsAccountsWithoutSafeCode() public {
        assertFalse(VelaWallet.isVelaWallet(makeAddr("eoa")));
        assertFalse(VelaWallet.isVelaWallet(address(this)));
    }
}
