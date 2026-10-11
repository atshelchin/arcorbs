// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISafe {
    function getOwners() external view returns (address[] memory);
}

interface ISafeProxy {
    function masterCopy() external view returns (address);
}

interface ISharedSigner {
    function getConfiguration(address account) external view returns (uint256 x, uint256 y, uint176 verifiers);
}

/// @notice Tells whether an address is a Vela Wallet account.
///
/// A Vela address is a pure function of its founding passkeys: an unmodified
/// Safe v1.4.1 proxy, created through the canonical proxy factory with a
/// `setup()` whose every byte follows from the P-256 public keys, and a
/// saltNonce that is the hash of those keys (vela-core `safe.rs`). So the
/// check reads the keys back from the chain, derives the address Vela would
/// have given them, and compares it with the account.
///
/// Owner 0 of every Vela Safe is Safe's shared WebAuthn signer, whose key sits
/// in the Safe's own storage. Each further key is a per-key signer proxy from
/// Safe's signer factory, which carries its key as immutables in its code. Both
/// shapes are covered: a per-key signer whose code does not hold the key its
/// address commits to cannot produce a matching account address.
///
/// The addresses below are the same on every chain Vela supports.
library VelaWallet {
    address internal constant SAFE_PROXY_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address internal constant SAFE_SINGLETON = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address internal constant SAFE_4337_MODULE = 0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226;
    address internal constant SAFE_MODULE_SETUP = 0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47;
    address internal constant MULTI_SEND = 0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526;
    address internal constant SHARED_SIGNER = 0x94a4F6affBd8975951142c3999aEAB7ecee555c2;
    address internal constant SIGNER_FACTORY = 0x1d31F259eE307358a26dFb23EB365939E8641195;
    address internal constant SIGNER_SINGLETON = 0x4E27b51350e6c2083EE19011120F50DAfEc5CA50;

    /// The P-256 precompile (EIP-7951 / RIP-7212) as Safe's `P256.Verifiers` word.
    uint256 internal constant VERIFIERS = 0x100;

    /// Vela caps a wallet at seven passkeys.
    uint256 internal constant MAX_KEYS = 7;

    /// keccak256 of the runtime code of a Safe v1.4.1 proxy.
    bytes32 internal constant PROXY_RUNTIME_CODEHASH =
        0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c;

    /// keccak256(SafeProxyFactory.proxyCreationCode() ‖ uint256(SAFE_SINGLETON)).
    bytes32 internal constant PROXY_INIT_CODE_HASH = 0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee;

    /// Creation code of a SafeWebAuthnSignerProxy, as the v0.2.1 factory deploys it.
    bytes internal constant SIGNER_CREATION_CODE =
        hex"610100346100ad57601f6101b538819003918201601f19168301916001600160401b038311848410176100b2578084926080946040528339810103126100ad578051906001600160a01b03821682036100ad5760208101516040820151606090920151926001600160b01b03841684036100ad5760805260a05260c05260e05260405160ec90816100c98239608051816082015260a05181604d015260c051816027015260e0518160010152f35b600080fd5b634e487b7160e01b600052604160045260246000fdfe7f000000000000000000000000000000000000000000000000000000000000000060b63601527f000000000000000000000000000000000000000000000000000000000000000060a03601527f000000000000000000000000000000000000000000000000000000000000000036608001523660006080376000806056360160807f00000000000000000000000000000000000000000000000000000000000000005af43d600060803e60b1573d6080fd5b3d6080f3fea26469706673582212201660515548d15702d720bbc046b457ca85e941a4559ab9f9518488e4c82e5ee964736f6c634300081a0033";

    /// Where a signer proxy's runtime code keeps its key.
    uint256 private constant SIGNER_RUNTIME_SIZE = 0xec;
    uint256 private constant SIGNER_Y_OFFSET = 0x27;
    uint256 private constant SIGNER_X_OFFSET = 0x4d;

    bytes4 private constant ENABLE_MODULES = bytes4(keccak256("enableModules(address[])"));
    bytes4 private constant CONFIGURE = bytes4(keccak256("configure((uint256,uint256,uint176))"));
    bytes4 private constant CREATE_SIGNER = bytes4(keccak256("createSigner(uint256,uint256,uint176)"));
    bytes4 private constant MULTI_SEND_SELECTOR = bytes4(keccak256("multiSend(bytes)"));
    bytes4 private constant SETUP =
        bytes4(keccak256("setup(address[],uint256,address,bytes,address,address,uint256,address)"));

    function isVelaWallet(address account) internal view returns (bool) {
        // A Safe v1.4.1 proxy on the canonical singleton. The proxy answers
        // `masterCopy()` itself, so from here on every call lands in known code.
        if (account.codehash != PROXY_RUNTIME_CODEHASH) return false;
        if (ISafeProxy(account).masterCopy() != SAFE_SINGLETON) return false;

        address[] memory owners = ISafe(account).getOwners();
        uint256 count = owners.length;
        if (count == 0 || count > MAX_KEYS || owners[0] != SHARED_SIGNER) return false;

        // keys = x₀ ‖ y₀ ‖ x₁ ‖ y₁ ‖ …, in owner order.
        uint256[] memory keys = new uint256[](count * 2);
        uint256 verifiers;
        (keys[0], keys[1], verifiers) = ISharedSigner(SHARED_SIGNER).getConfiguration(account);
        if (verifiers != VERIFIERS) return false;
        for (uint256 i = 1; i < count; i++) {
            if (owners[i].code.length != SIGNER_RUNTIME_SIZE) return false;
            (keys[i * 2], keys[i * 2 + 1]) = _signerKey(owners[i]);
        }

        return predict(keys) == account;
    }

    /// @notice The address Vela gives a wallet founded by `keys`.
    /// @param keys x₀ ‖ y₀ ‖ x₁ ‖ y₁ ‖ …. The first key is the shared signer's;
    /// Vela sorts the rest by x then y before it derives anything.
    function predict(uint256[] memory keys) internal pure returns (address) {
        bytes32 initializer = keccak256(setupData(keys));
        bytes32 saltNonce = keccak256(abi.encodePacked(keys));
        bytes32 salt = keccak256(abi.encodePacked(initializer, saltNonce));
        return _create2(SAFE_PROXY_FACTORY, salt, PROXY_INIT_CODE_HASH);
    }

    /// @notice The `Safe.setup()` calldata Vela founds a wallet with.
    function setupData(uint256[] memory keys) internal pure returns (bytes memory) {
        uint256 count = keys.length / 2;
        address[] memory owners = new address[](count);
        owners[0] = SHARED_SIGNER;

        address[] memory modules = new address[](1);
        modules[0] = SAFE_4337_MODULE;

        // Delegatecalls from the Safe: enable the 4337 module and write the
        // first key into the Safe's storage. Then one plain call per further
        // key, deploying its signer proxy.
        bytes memory batch = abi.encodePacked(
            _leg(1, SAFE_MODULE_SETUP, abi.encodeWithSelector(ENABLE_MODULES, modules)),
            _leg(1, SHARED_SIGNER, abi.encodeWithSelector(CONFIGURE, keys[0], keys[1], VERIFIERS))
        );
        for (uint256 i = 1; i < count; i++) {
            uint256 x = keys[i * 2];
            uint256 y = keys[i * 2 + 1];
            owners[i] = signerAddress(x, y);
            batch = abi.encodePacked(
                batch, _leg(0, SIGNER_FACTORY, abi.encodeWithSelector(CREATE_SIGNER, x, y, VERIFIERS))
            );
        }

        return abi.encodeWithSelector(
            SETUP,
            owners,
            uint256(1),
            MULTI_SEND,
            abi.encodeWithSelector(MULTI_SEND_SELECTOR, batch),
            SAFE_4337_MODULE,
            address(0),
            uint256(0),
            address(0)
        );
    }

    /// @notice The signer proxy the factory deploys for one key.
    function signerAddress(uint256 x, uint256 y) internal pure returns (address) {
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(SIGNER_CREATION_CODE, uint256(uint160(SIGNER_SINGLETON)), x, y, VERIFIERS));
        return _create2(SIGNER_FACTORY, bytes32(0), initCodeHash);
    }

    function _signerKey(address signer) private view returns (uint256 x, uint256 y) {
        assembly ("memory-safe") {
            extcodecopy(signer, 0x00, SIGNER_X_OFFSET, 0x20)
            x := mload(0x00)
            extcodecopy(signer, 0x00, SIGNER_Y_OFFSET, 0x20)
            y := mload(0x00)
        }
    }

    /// One packed MultiSend transaction, always with no value.
    function _leg(uint8 operation, address to, bytes memory data) private pure returns (bytes memory) {
        return abi.encodePacked(operation, to, uint256(0), data.length, data);
    }

    function _create2(address deployer, bytes32 salt, bytes32 initCodeHash) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }
}
