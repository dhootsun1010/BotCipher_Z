pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedChatbot is ZamaEthereumConfig {
    
    struct ChatSession {
        address user;
        euint32 encryptedMessage;
        uint256 timestamp;
        bool isProcessed;
        uint32 decryptedIntent;
        string response;
    }
    
    mapping(uint256 => ChatSession) public sessions;
    uint256 public sessionCount = 0;
    
    event MessageReceived(uint256 indexed sessionId, address indexed user);
    event ResponseGenerated(uint256 indexed sessionId, string response);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function sendMessage(
        externalEuint32 encryptedMessage,
        bytes calldata inputProof
    ) external {
        require(FHE.isInitialized(FHE.fromExternal(encryptedMessage, inputProof)), "Invalid encrypted input");
        
        sessions[sessionCount] = ChatSession({
            user: msg.sender,
            encryptedMessage: FHE.fromExternal(encryptedMessage, inputProof),
            timestamp: block.timestamp,
            isProcessed: false,
            decryptedIntent: 0,
            response: ""
        });
        
        FHE.allowThis(sessions[sessionCount].encryptedMessage);
        FHE.makePubliclyDecryptable(sessions[sessionCount].encryptedMessage);
        
        emit MessageReceived(sessionCount, msg.sender);
        sessionCount++;
    }
    
    function processMessage(
        uint256 sessionId,
        bytes memory abiEncodedClearIntent,
        bytes memory decryptionProof
    ) external {
        require(sessionId < sessionCount, "Invalid session ID");
        require(!sessions[sessionId].isProcessed, "Message already processed");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(sessions[sessionId].encryptedMessage);
        
        FHE.checkSignatures(cts, abiEncodedClearIntent, decryptionProof);
        
        uint32 decodedIntent = abi.decode(abiEncodedClearIntent, (uint32));
        
        sessions[sessionId].decryptedIntent = decodedIntent;
        sessions[sessionId].isProcessed = true;
        
        // Generate response based on decrypted intent
        sessions[sessionId].response = _generateResponse(decodedIntent);
        
        emit ResponseGenerated(sessionId, sessions[sessionId].response);
    }
    
    function getResponse(uint256 sessionId) external view returns (string memory) {
        require(sessionId < sessionCount, "Invalid session ID");
        require(sessions[sessionId].isProcessed, "Message not processed yet");
        return sessions[sessionId].response;
    }
    
    function getSession(uint256 sessionId) external view returns (
        address user,
        uint256 timestamp,
        bool isProcessed,
        uint32 decryptedIntent,
        string memory response
    ) {
        require(sessionId < sessionCount, "Invalid session ID");
        ChatSession storage session = sessions[sessionId];
        return (
            session.user,
            session.timestamp,
            session.isProcessed,
            session.decryptedIntent,
            session.response
        );
    }
    
    function getSessionCount() external view returns (uint256) {
        return sessionCount;
    }
    
    function _generateResponse(uint32 intent) internal pure returns (string memory) {
        // Simplified response generation based on intent
        if (intent == 1) {
            return "Hello! How can I assist you today?";
        } else if (intent == 2) {
            return "I can help with that. Please provide more details.";
        } else if (intent == 3) {
            return "I'm sorry, I didn't understand. Could you rephrase?";
        } else {
            return "Thank you for your message. I'll get back to you soon.";
        }
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}

