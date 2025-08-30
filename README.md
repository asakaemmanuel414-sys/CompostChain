# 🌱 CompostChain: Blockchain for Compost Tracking and Credits

Welcome to CompostChain, a decentralized system built on the Stacks blockchain to track organic waste from collection to compost production and soil enhancement! This project addresses real-world problems like inefficient waste management, lack of transparency in recycling processes, and incentivizing sustainable practices by linking verified compost cycles to redeemable soil enhancement credits (e.g., for carbon offsets or rewards).

By using blockchain, we ensure immutable tracking, prevent fraud in waste reporting, and reward participants with tokenized credits that can be traded or redeemed. Perfect for municipalities, farms, and eco-conscious businesses.

## ✨ Features

♻️ Register organic waste batches with verifiable hashes  
📈 Track the full lifecycle: waste → compost → soil application  
✅ Verify process steps with immutable timestamps  
💰 Issue soil enhancement credits as fungible tokens  
🔄 Trade or redeem credits in a built-in marketplace  
🚫 Prevent double-counting or fraudulent claims  
🌍 Integrate oracles for real-world data (e.g., weight measurements)  
📊 Generate reports on environmental impact (e.g., CO2 savings)

## 🛠 How It Works

**For Waste Producers (e.g., Households or Businesses)**  
- Generate a unique hash for your organic waste batch (e.g., via photo or description).  
- Call the WasteRegistration contract to log the batch, including weight, type, and timestamp.  
Your waste is now on-chain, ready for pickup and processing!

**For Compost Facilities**  
- Claim a registered waste batch via CompostProcessing.  
- Update status with processing details (e.g., composting duration, quality checks).  
- Once complete, verify via CompostVerification to finalize the compost product.

**For Farmers or Soil Users**  
- Receive verified compost and log its application via SoilEnhancement.  
- Provide proof (e.g., via oracle-integrated sensors or hashes).  
Boom! Credits are automatically issued based on the enhanced soil volume.

**For Credit Holders**  
- Use the CreditIssuance contract to mint tokens proportional to the waste-to-soil cycle.  
- Trade them on the Marketplace contract or redeem for real-world perks (e.g., discounts on eco-products).  

**Verification for All**  
- Anyone can query contracts like WasteRegistration or SoilEnhancement to view full traceability.  
- Use VerifyCycle to confirm a complete, fraud-free loop and associated credits.

This system promotes circular economies, reduces methane emissions from landfills, and quantifies environmental benefits transparently.

## 📜 Smart Contracts

CompostChain is built with 8 smart contracts in Clarity for modularity, security, and scalability on Stacks. Here's an overview:

1. **UserRegistry.clar**  
   Handles user registration and roles (e.g., producer, composter, farmer). Ensures only authorized principals interact with the system.

2. **WasteRegistration.clar**  
   Allows registering organic waste batches with hashes, metadata (weight, type), and timestamps. Prevents duplicates via unique IDs.

3. **CompostProcessing.clar**  
   Tracks the composting stage: claiming waste, updating progress, and logging intermediate data like temperature or duration.

4. **CompostVerification.clar**  
   Verifies compost quality and completion, integrating with oracles for external proofs. Emits events for successful verification.

5. **SoilEnhancement.clar**  
   Records compost application to soil, including location hashes and enhancement metrics (e.g., area covered).

6. **CreditIssuance.clar**  
   Mints fungible tokens (SIP-10 compliant) as credits based on verified cycles. Calculates rewards using predefined formulas (e.g., credits per kg of waste).

7. **Marketplace.clar**  
   Enables peer-to-peer trading of credits with buy/sell orders, escrow, and atomic swaps for security.

8. **Governance.clar**  
   Manages system parameters (e.g., credit rates, oracle integrations) via DAO-like voting for registered users.

These contracts interact seamlessly: e.g., WasteRegistration feeds into CompostProcessing, which triggers CreditIssuance upon verification. Deploy them on Stacks for a fully decentralized compost ecosystem!