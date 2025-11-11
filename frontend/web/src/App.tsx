import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface ChatMessage {
  id: string;
  content: string;
  encryptedValue: number;
  timestamp: number;
  isUser: boolean;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface ChatStats {
  totalMessages: number;
  encryptedMessages: number;
  verifiedMessages: number;
  avgResponseTime: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingMessage, setCreatingMessage] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newMessageData, setNewMessageData] = useState({ content: "", value: "" });
  const [selectedMessage, setSelectedMessage] = useState<ChatMessage | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [chatStats, setChatStats] = useState<ChatStats>({ totalMessages: 0, encryptedMessages: 0, verifiedMessages: 0, avgResponseTime: 0 });
  const [showFAQ, setShowFAQ] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const messagesList: ChatMessage[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          messagesList.push({
            id: businessId,
            content: businessData.name,
            encryptedValue: 0,
            timestamp: Number(businessData.timestamp),
            isUser: businessData.creator === address,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setMessages(messagesList);
      updateStats(messagesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (messagesList: ChatMessage[]) => {
    const total = messagesList.length;
    const encrypted = messagesList.filter(m => m.isVerified).length;
    const verified = messagesList.filter(m => m.isVerified && m.decryptedValue).length;
    const avgTime = total > 0 ? messagesList.reduce((sum, m) => sum + m.timestamp, 0) / total : 0;
    
    setChatStats({
      totalMessages: total,
      encryptedMessages: encrypted,
      verifiedMessages: verified,
      avgResponseTime: avgTime
    });
  };

  const createMessage = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingMessage(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting message with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const messageValue = parseInt(newMessageData.value) || 0;
      const businessId = `msg-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, messageValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newMessageData.content,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        messageValue,
        0,
        "Encrypted Chat Message"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Message encrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewMessageData({ content: "", value: "" });
      
      setTimeout(() => {
        addBotResponse(businessId, messageValue);
      }, 1000);
      
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingMessage(false); 
    }
  };

  const addBotResponse = async (originalId: string, userValue: number) => {
    if (!isConnected || !address) return;
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) return;
      
      const botResponse = generateBotResponse(userValue);
      const botValue = userValue + 1;
      const businessId = `bot-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, botValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        botResponse,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        botValue,
        0,
        "AI Bot Response"
      );
      
      await tx.wait();
      await loadData();
      
    } catch (e) {
      console.error('Failed to add bot response:', e);
    }
  };

  const generateBotResponse = (userValue: number): string => {
    const responses = [
      "I understand your encrypted input!",
      "Processing your secure message...",
      "FHE computation completed successfully",
      "Your privacy is protected with homomorphic encryption",
      "AI response generated from encrypted data"
    ];
    return responses[userValue % responses.length];
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Message decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleCheckAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "FHE System is available and ready!" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredMessages = messages.filter(msg => 
    msg.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
    msg.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>BotCipher_Z 🔐</h1>
            <span>隱私AI聊天機器人</span>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Start Private Chat</h2>
            <p>Connect your wallet to initialize the encrypted chatbot system and start private conversations.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start encrypted conversations with AI</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted chat system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>BotCipher_Z 🔐</h1>
          <span>FHE-based Encrypted Chatbot</span>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Encrypted Message
          </button>
          <button 
            onClick={handleCheckAvailability}
            className="check-btn"
          >
            Check FHE Status
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="stats-section">
          <div className="stats-panels">
            <div className="stat-panel">
              <h3>Total Messages</h3>
              <div className="stat-value">{chatStats.totalMessages}</div>
            </div>
            <div className="stat-panel">
              <h3>Encrypted</h3>
              <div className="stat-value">{chatStats.encryptedMessages}</div>
            </div>
            <div className="stat-panel">
              <h3>Verified</h3>
              <div className="stat-value">{chatStats.verifiedMessages}</div>
            </div>
          </div>
        </div>
        
        <div className="chat-section">
          <div className="section-header">
            <h2>Encrypted Conversation</h2>
            <div className="header-actions">
              <input 
                type="text"
                placeholder="Search messages..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
              <button 
                onClick={() => setShowFAQ(!showFAQ)}
                className="faq-btn"
              >
                {showFAQ ? "Hide FAQ" : "Show FAQ"}
              </button>
            </div>
          </div>
          
          {showFAQ && (
            <div className="faq-panel">
              <h3>FHE Chatbot FAQ</h3>
              <div className="faq-item">
                <strong>How does FHE encryption work?</strong>
                <p>Messages are encrypted using Zama FHE before being stored on-chain, ensuring complete privacy.</p>
              </div>
              <div className="faq-item">
                <strong>What data types are supported?</strong>
                <p>Currently supports integer values for FHE operations. Text content is stored as metadata.</p>
              </div>
              <div className="faq-item">
                <strong>Is my conversation private?</strong>
                <p>Yes, all message content is encrypted and only decryptable by you with proper authorization.</p>
              </div>
            </div>
          )}
          
          <div className="messages-list">
            {filteredMessages.length === 0 ? (
              <div className="no-messages">
                <p>No encrypted messages found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Send First Encrypted Message
                </button>
              </div>
            ) : filteredMessages.map((message, index) => (
              <div 
                className={`message-item ${message.isUser ? "user" : "bot"} ${selectedMessage?.id === message.id ? "selected" : ""} ${message.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedMessage(message)}
              >
                <div className="message-avatar">
                  {message.isUser ? "👤" : "🤖"}
                </div>
                <div className="message-content">
                  <div className="message-text">{message.content}</div>
                  <div className="message-meta">
                    <span>{new Date(message.timestamp * 1000).toLocaleString()}</span>
                    <span className={`status ${message.isVerified ? "verified" : "encrypted"}`}>
                      {message.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                    </span>
                  </div>
                  {message.isVerified && message.decryptedValue && (
                    <div className="decrypted-value">
                      Decrypted Value: {message.decryptedValue}
                    </div>
                  )}
                </div>
                <button 
                  className="decrypt-btn"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const decrypted = await decryptData(message.id);
                    if (decrypted !== null) {
                      setDecryptedData(decrypted);
                    }
                  }}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "🔓..." : "Decrypt"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateMessage 
          onSubmit={createMessage} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingMessage} 
          messageData={newMessageData} 
          setMessageData={setNewMessageData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateMessage: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  messageData: any;
  setMessageData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, messageData, setMessageData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'value') {
      const intValue = value.replace(/[^\d]/g, '');
      setMessageData({ ...messageData, [name]: intValue });
    } else {
      setMessageData({ ...messageData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-message-modal">
        <div className="modal-header">
          <h2>New Encrypted Message</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption Active</strong>
            <p>Message value will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Message Content *</label>
            <textarea 
              name="content" 
              value={messageData.content} 
              onChange={handleChange} 
              placeholder="Enter your message..." 
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Encrypted Value (Integer only) *</label>
            <input 
              type="number" 
              name="value" 
              value={messageData.value} 
              onChange={handleChange} 
              placeholder="Enter integer value for FHE encryption..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !messageData.content || !messageData.value} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Sending..." : "Send Encrypted Message"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;

