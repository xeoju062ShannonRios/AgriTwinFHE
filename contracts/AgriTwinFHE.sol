// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AgriTwinFHE is SepoliaConfig {
    struct EncryptedFarmData {
        uint256 id;
        euint32 encryptedSoilData;
        euint32 encryptedClimateData;
        euint32 encryptedStrategy;
        uint256 timestamp;
    }
    
    struct DecryptedFarmData {
        string soilData;
        string climateData;
        string strategy;
        bool isRevealed;
    }

    uint256 public farmCount;
    mapping(uint256 => EncryptedFarmData) public encryptedFarms;
    mapping(uint256 => DecryptedFarmData) public decryptedFarms;
    
    mapping(string => euint32) private encryptedStrategyCount;
    string[] private strategyList;
    
    mapping(uint256 => uint256) private requestToFarmId;
    
    event FarmSubmitted(uint256 indexed id, uint256 timestamp);
    event SimulationRequested(uint256 indexed id);
    event FarmDataRevealed(uint256 indexed id);
    
    modifier onlyFarmer(uint256 farmId) {
        _;
    }
    
    function submitEncryptedFarmData(
        euint32 encryptedSoilData,
        euint32 encryptedClimateData,
        euint32 encryptedStrategy
    ) public {
        farmCount += 1;
        uint256 newId = farmCount;
        
        encryptedFarms[newId] = EncryptedFarmData({
            id: newId,
            encryptedSoilData: encryptedSoilData,
            encryptedClimateData: encryptedClimateData,
            encryptedStrategy: encryptedStrategy,
            timestamp: block.timestamp
        });
        
        decryptedFarms[newId] = DecryptedFarmData({
            soilData: "",
            climateData: "",
            strategy: "",
            isRevealed: false
        });
        
        emit FarmSubmitted(newId, block.timestamp);
    }
    
    function requestFarmSimulation(uint256 farmId) public onlyFarmer(farmId) {
        EncryptedFarmData storage farm = encryptedFarms[farmId];
        require(!decryptedFarms[farmId].isRevealed, "Already revealed");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(farm.encryptedSoilData);
        ciphertexts[1] = FHE.toBytes32(farm.encryptedClimateData);
        ciphertexts[2] = FHE.toBytes32(farm.encryptedStrategy);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.simulateFarm.selector);
        requestToFarmId[reqId] = farmId;
        
        emit SimulationRequested(farmId);
    }
    
    function simulateFarm(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 farmId = requestToFarmId[requestId];
        require(farmId != 0, "Invalid request");
        
        EncryptedFarmData storage eFarm = encryptedFarms[farmId];
        DecryptedFarmData storage dFarm = decryptedFarms[farmId];
        require(!dFarm.isRevealed, "Already revealed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        string[] memory results = abi.decode(cleartexts, (string[]));
        
        dFarm.soilData = results[0];
        dFarm.climateData = results[1];
        dFarm.strategy = results[2];
        dFarm.isRevealed = true;
        
        if (FHE.isInitialized(encryptedStrategyCount[dFarm.strategy]) == false) {
            encryptedStrategyCount[dFarm.strategy] = FHE.asEuint32(0);
            strategyList.push(dFarm.strategy);
        }
        encryptedStrategyCount[dFarm.strategy] = FHE.add(
            encryptedStrategyCount[dFarm.strategy], 
            FHE.asEuint32(1)
        );
        
        emit FarmDataRevealed(farmId);
    }
    
    function getDecryptedFarmData(uint256 farmId) public view returns (
        string memory soilData,
        string memory climateData,
        string memory strategy,
        bool isRevealed
    ) {
        DecryptedFarmData storage f = decryptedFarms[farmId];
        return (f.soilData, f.climateData, f.strategy, f.isRevealed);
    }
    
    function getEncryptedStrategyCount(string memory strategy) public view returns (euint32) {
        return encryptedStrategyCount[strategy];
    }
    
    function requestStrategyCountDecryption(string memory strategy) public {
        euint32 count = encryptedStrategyCount[strategy];
        require(FHE.isInitialized(count), "Strategy not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptStrategyCount.selector);
        requestToFarmId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(strategy)));
    }
    
    function decryptStrategyCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 strategyHash = requestToFarmId[requestId];
        string memory strategy = getStrategyFromHash(strategyHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 count = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getStrategyFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < strategyList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(strategyList[i]))) == hash) {
                return strategyList[i];
            }
        }
        revert("Strategy not found");
    }
}