// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {ArcOrbs} from "../src/ArcOrbs.sol";

contract Deploy is Script {
    function run() external returns (ArcOrbs orbs) {
        vm.startBroadcast();
        orbs = new ArcOrbs();
        vm.stopBroadcast();
    }
}
