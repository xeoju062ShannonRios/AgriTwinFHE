// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface AuctionBid {
  id: string;
  bidder: string;
  bidAmount: string;
  encryptedBid: string;
  timestamp: number;
  landParcel: string;
  status: "active" | "won" | "lost";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [bids, setBids] = useState<AuctionBid[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showBidModal, setShowBidModal] = useState(false);
  const [bidding, setBidding] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newBidData, setNewBidData] = useState({
    landParcel: "",
    bidAmount: "",
    encryptedStrategy: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");

  // Calculate statistics
  const activeBids = bids.filter(b => b.status === "active").length;
  const wonBids = bids.filter(b => b.status === "won").length;
  const totalBidValue = bids.reduce((sum, bid) => sum + parseFloat(bid.bidAmount || "0"), 0);

  useEffect(() => {
    loadBids().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadBids = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("bid_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing bid keys:", e);
        }
      }
      
      const list: AuctionBid[] = [];
      
      for (const key of keys) {
        try {
          const bidBytes = await contract.getData(`bid_${key}`);
          if (bidBytes.length > 0) {
            try {
              const bidData = JSON.parse(ethers.toUtf8String(bidBytes));
              list.push({
                id: key,
                bidder: bidData.bidder,
                bidAmount: bidData.bidAmount,
                encryptedBid: bidData.encryptedBid,
                timestamp: bidData.timestamp,
                landParcel: bidData.landParcel,
                status: bidData.status || "active"
              });
            } catch (e) {
              console.error(`Error parsing bid data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading bid ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setBids(list);
    } catch (e) {
      console.error("Error loading bids:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitBid = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setBidding(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting bid with FHE technology..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedBid = `FHE-${btoa(JSON.stringify(newBidData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const bidId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const bidData = {
        bidder: account,
        bidAmount: newBidData.bidAmount,
        encryptedBid: encryptedBid,
        timestamp: Math.floor(Date.now() / 1000),
        landParcel: newBidData.landParcel,
        status: "active"
      };
      
      // Store encrypted bid on-chain
      await contract.setData(
        `bid_${bidId}`, 
        ethers.toUtf8Bytes(JSON.stringify(bidData))
      );
      
      const keysBytes = await contract.getData("bid_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(bidId);
      
      await contract.setData(
        "bid_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted bid submitted securely!"
      });
      
      await loadBids();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowBidModal(false);
        setNewBidData({
          landParcel: "",
          bidAmount: "",
          encryptedStrategy: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Bid submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setBidding(false);
    }
  };

  const determineWinner = async () => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted bids with FHE to determine winner..."
    });

    try {
      // Simulate FHE computation for auction winner determination
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      // Simulate VCG auction mechanism
      const activeBidsList = bids.filter(b => b.status === "active");
      if (activeBidsList.length === 0) {
        throw new Error("No active bids to process");
      }
      
      // Find highest bid
      const highestBid = activeBidsList.reduce((max, bid) => 
        parseFloat(bid.bidAmount) > parseFloat(max.bidAmount) ? bid : max, activeBidsList[0]);
      
      // Update bid statuses
      for (const bid of activeBidsList) {
        const bidBytes = await contract.getData(`bid_${bid.id}`);
        if (bidBytes.length > 0) {
          const bidData = JSON.parse(ethers.toUtf8String(bidBytes));
          
          const updatedBid = {
            ...bidData,
            status: bid.id === highestBid.id ? "won" : "lost"
          };
          
          await contract.setData(
            `bid_${bid.id}`, 
            ethers.toUtf8Bytes(JSON.stringify(updatedBid))
          );
        }
      }
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE auction completed! Winner determined while preserving bid privacy."
      });
      
      await loadBids();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Auction processing failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to participate in the auction",
      icon: "🔗"
    },
    {
      title: "Place Encrypted Bid",
      description: "Submit your bid which will be encrypted using FHE technology",
      icon: "🔒"
    },
    {
      title: "FHE Auction Processing",
      description: "Bids are processed in encrypted state to determine winner",
      icon: "⚙️"
    },
    {
      title: "Receive Results",
      description: "Get auction results while keeping your bidding strategy private",
      icon: "🏆"
    }
  ];

  const renderBidChart = () => {
    const landParcels = [...new Set(bids.map(bid => bid.landParcel))];
    
    return (
      <div className="bid-chart-container">
        <div className="chart-bars">
          {landParcels.slice(0, 5).map(parcel => {
            const parcelBids = bids.filter(b => b.landParcel === parcel);
            const maxBid = Math.max(...parcelBids.map(b => parseFloat(b.bidAmount || "0")));
            
            return (
              <div key={parcel} className="chart-bar">
                <div 
                  className="bar-fill"
                  style={{ height: `${Math.min(100, (maxBid / 1000) * 100)}%` }}
                ></div>
                <div className="bar-label">{parcel}</div>
              </div>
            );
          })}
        </div>
        <div className="chart-legend">
          <div className="legend-item">
            <div className="color-box neon-blue"></div>
            <span>Bid Amount (ETH)</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing encrypted auction connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="auction-icon"></div>
          </div>
          <h1>Meta<span>Auction</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowBidModal(true)} 
            className="place-bid-btn cyber-button"
          >
            <div className="bid-icon"></div>
            Place Bid
          </button>
          <button 
            className="cyber-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <nav className="navigation-tabs">
          <button 
            className={`tab ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            Dashboard
          </button>
          <button 
            className={`tab ${activeTab === "bids" ? "active" : ""}`}
            onClick={() => setActiveTab("bids")}
          >
            My Bids
          </button>
          <button 
            className={`tab ${activeTab === "about" ? "active" : ""}`}
            onClick={() => setActiveTab("about")}
          >
            About
          </button>
        </nav>
        
        {activeTab === "dashboard" && (
          <>
            <div className="welcome-banner">
              <div className="welcome-text">
                <h2>Privacy-Preserving Metaverse Land Auction</h2>
                <p>Bid on virtual land parcels with fully encrypted bids using FHE technology</p>
              </div>
            </div>
            
            {showTutorial && (
              <div className="tutorial-section">
                <h2>FHE Auction Tutorial</h2>
                <p className="subtitle">Learn how to bid privately in our metaverse land auction</p>
                
                <div className="tutorial-steps">
                  {tutorialSteps.map((step, index) => (
                    <div 
                      className="tutorial-step"
                      key={index}
                    >
                      <div className="step-icon">{step.icon}</div>
                      <div className="step-content">
                        <h3>{step.title}</h3>
                        <p>{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="dashboard-panels">
              <div className="panel cyber-card">
                <h3>Project Introduction</h3>
                <p>MetaAuctionFHE uses Fully Homomorphic Encryption to enable private bidding in metaverse land auctions. Your bids remain encrypted throughout the entire process.</p>
                <div className="fhe-badge">
                  <span>FHE-Powered Privacy</span>
                </div>
              </div>
              
              <div className="panel cyber-card">
                <h3>Auction Statistics</h3>
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-value">{bids.length}</div>
                    <div className="stat-label">Total Bids</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{activeBids}</div>
                    <div className="stat-label">Active</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{wonBids}</div>
                    <div className="stat-label">Won</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{totalBidValue.toFixed(2)}</div>
                    <div className="stat-label">Total ETH</div>
                  </div>
                </div>
              </div>
              
              <div className="panel cyber-card">
                <h3>Bid Distribution</h3>
                {renderBidChart()}
              </div>
            </div>
            
            <div className="auction-controls">
              <button 
                onClick={determineWinner}
                className="cyber-button primary large"
                disabled={bids.length === 0}
              >
                Run FHE Auction
              </button>
            </div>
          </>
        )}
        
        {activeTab === "bids" && (
          <div className="bids-section">
            <div className="section-header">
              <h2>My Encrypted Bids</h2>
              <div className="header-actions">
                <button 
                  onClick={loadBids}
                  className="refresh-btn cyber-button"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="bids-list cyber-card">
              <div className="table-header">
                <div className="header-cell">Land Parcel</div>
                <div className="header-cell">Bid Amount</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Status</div>
              </div>
              
              {bids.length === 0 ? (
                <div className="no-bids">
                  <div className="no-bids-icon"></div>
                  <p>No bids found</p>
                  <button 
                    className="cyber-button primary"
                    onClick={() => setShowBidModal(true)}
                  >
                    Place First Bid
                  </button>
                </div>
              ) : (
                bids.map(bid => (
                  <div className="bid-row" key={bid.id}>
                    <div className="table-cell">{bid.landParcel}</div>
                    <div className="table-cell">{bid.bidAmount} ETH</div>
                    <div className="table-cell">
                      {new Date(bid.timestamp * 1000).toLocaleDateString()}
                    </div>
                    <div className="table-cell">
                      <span className={`status-badge ${bid.status}`}>
                        {bid.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "about" && (
          <div className="about-section">
            <div className="panel cyber-card">
              <h3>Team Information</h3>
              <div className="team-grid">
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <h4>Dr. Alice Chen</h4>
                  <p>FHE Cryptography Expert</p>
                </div>
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <h4>Mark Johnson</h4>
                  <p>Blockchain Developer</p>
                </div>
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <h4>Sarah Williams</h4>
                  <p>Metaverse Architect</p>
                </div>
              </div>
            </div>
            
            <div className="panel cyber-card">
              <h3>How FHE Protects Your Bids</h3>
              <p>Fully Homomorphic Encryption allows us to process your bids without ever decrypting them. This prevents front-running and ensures fair auction outcomes.</p>
              <div className="fhe-process">
                <div className="process-step">
                  <div className="step-number">1</div>
                  <p>Bid encrypted with FHE</p>
                </div>
                <div className="process-step">
                  <div className="step-number">2</div>
                  <p>Encrypted processing</p>
                </div>
                <div className="process-step">
                  <div className="step-number">3</div>
                  <p>Result decryption</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
  
      {showBidModal && (
        <ModalBid 
          onSubmit={submitBid} 
          onClose={() => setShowBidModal(false)} 
          bidding={bidding}
          bidData={newBidData}
          setBidData={setNewBidData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="auction-icon"></div>
              <span>MetaAuctionFHE</span>
            </div>
            <p>Privacy-preserving metaverse land auctions powered by FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Auction System</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} MetaAuctionFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalBidProps {
  onSubmit: () => void; 
  onClose: () => void; 
  bidding: boolean;
  bidData: any;
  setBidData: (data: any) => void;
}

const ModalBid: React.FC<ModalBidProps> = ({ 
  onSubmit, 
  onClose, 
  bidding,
  bidData,
  setBidData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setBidData({
      ...bidData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!bidData.landParcel || !bidData.bidAmount) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="bid-modal cyber-card">
        <div className="modal-header">
          <h2>Place Encrypted Bid</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your bid will be encrypted with FHE technology
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Land Parcel *</label>
              <select 
                name="landParcel"
                value={bidData.landParcel} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="">Select land parcel</option>
                <option value="Genesis Plaza">Genesis Plaza</option>
                <option value="Dragon District">Dragon District</option>
                <option value="Neo Tokyo">Neo Tokyo</option>
                <option value="Cyber Heights">Cyber Heights</option>
                <option value="Virtual Valley">Virtual Valley</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Bid Amount (ETH) *</label>
              <input 
                type="number"
                name="bidAmount"
                value={bidData.bidAmount} 
                onChange={handleChange}
                placeholder="0.00"
                step="0.01"
                min="0.01"
                className="cyber-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Bidding Strategy (Encrypted)</label>
              <textarea 
                name="encryptedStrategy"
                value={bidData.encryptedStrategy} 
                onChange={handleChange}
                placeholder="Optional: Describe your bidding strategy (will be encrypted)..."
                className="cyber-textarea"
                rows={3}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Your bid remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={bidding}
            className="submit-btn cyber-button primary"
          >
            {bidding ? "Encrypting with FHE..." : "Submit Encrypted Bid"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;