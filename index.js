const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const Port = 5000;

// CORS
const corsOptions = {
    origin: ["http://localhost:5173", 'http://localhost:5174', 'https://megamart-admin-self.vercel.app', 'https://investly-ecru.vercel.app'], // frontend URL
    credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.z8jshpb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        await client.connect();
        const db = client.db("megamart");
        const usersCollection = db.collection("users");
        const depositsCollection = db.collection("deposits");
        const withdrawCollection = db.collection("withdraws");
        const plansCollection = db.collection("plans");
        const walletsCollection = db.collection("wallet");
        const tasksCollection = db.collection("tasks");
        const productsCollection = db.collection("products");
        const ordersCollection = db.collection("orders");
        const supportCollection = db.collection("support");

        app.post("/register", async (req, res) => {
            const { username, password, sponsorId } = req.body;

            if (!username || !password || !sponsorId) {
                return res.status(400).send({ message: "All fields are required" });
            }

            const existingUser = await usersCollection.findOne({ username });
            if (existingUser) return res.status(400).send({ message: "Username already taken" });

            const sponsorUser = await usersCollection.findOne({ referCode: sponsorId });
            if (!sponsorUser) return res.status(400).send({ message: "Invalid sponsor ID" });

            // Generate numeric referCode
            const referCode = Math.floor(100000 + Math.random() * 900000).toString();

            // Create new user
            const newUser = {
                username,
                password, // ⚠️ In production use bcrypt
                sponsorId,
                referCode,
                balance: 0,
                generation: {}, // optional for upline
                createdAt: new Date(),
            };

            const result = await usersCollection.insertOne(newUser);

            // Update sponsor's generation arrays
            const level1 = Array.isArray(sponsorUser.generation?.level1) ? sponsorUser.generation.level1 : [];
            level1.push(username);

            await usersCollection.updateOne(
                { referCode: sponsorUser.referCode },
                { $set: { "generation.level1": level1 } }
            );

            // Level2 (sponsor's sponsor)
            if (sponsorUser.sponsorId) {
                const sponsorOfSponsor = await usersCollection.findOne({ referCode: sponsorUser.sponsorId });
                if (sponsorOfSponsor) {
                    const level2 = Array.isArray(sponsorOfSponsor.generation?.level2) ? sponsorOfSponsor.generation.level2 : [];
                    level2.push(username);
                    await usersCollection.updateOne(
                        { referCode: sponsorOfSponsor.referCode },
                        { $set: { "generation.level2": level2 } }
                    );

                    // Level3 (sponsor's sponsor's sponsor)
                    if (sponsorOfSponsor.sponsorId) {
                        const sponsorOfSponsorOfSponsor = await usersCollection.findOne({ referCode: sponsorOfSponsor.sponsorId });
                        if (sponsorOfSponsorOfSponsor) {
                            const level3 = Array.isArray(sponsorOfSponsorOfSponsor.generation?.level3) ? sponsorOfSponsorOfSponsor.generation.level3 : [];
                            level3.push(username);
                            await usersCollection.updateOne(
                                { referCode: sponsorOfSponsorOfSponsor.referCode },
                                { $set: { "generation.level3": level3 } }
                            );
                        }
                    }
                }
            }

            res.send({
                message: "User registered successfully",
                userId: result.insertedId,
                referCode,
            });
        });

        // POST /users/by-usernames
        app.post("/users/by-usernames", async (req, res) => {
            const { usernames } = req.body; // array of usernames
            if (!usernames || !Array.isArray(usernames)) {
                return res.status(400).send({ message: "Invalid usernames" });
            }

            try {
                const users = await usersCollection
                    .find({ username: { $in: usernames } })
                    .project({ username: 1, balance: 1, _id: 0 })
                    .toArray();
                res.send(users);
            } catch (err) {
                res.status(500).send({ message: "Server error" });
            }
        });


        // --------------------------
        app.get("/users", async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send(users);
        });

        app.get("/users/:username", async (req, res) => {
            try {
                const { username } = req.params;
                const user = await usersCollection.findOne(
                    { username },
                    { projection: { password: 0 } } // hide password
                );

                if (!user) return res.status(404).send({ message: "User not found" });
                res.send(user);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });


        // app.put("/users/:id", async (req, res) => {
        //     try {
        //         const { id } = req.params;
        //         const { balance } = req.body;

        //         if (balance === undefined) return res.status(400).send({ message: "Balance is required" });

        //         const result = await usersCollection.updateOne(
        //             { _id: new ObjectId(id) },
        //             { $set: { balance: Number(balance) } }
        //         );

        //         if (result.matchedCount === 0) return res.status(404).send({ message: "User not found" });

        //         res.send({ message: "User updated successfully" });
        //     } catch (err) {
        //         console.error(err);
        //         res.status(500).send({ message: "Server error" });
        //     }
        // });

        // Delete user
        app.delete("/users/:id", async (req, res) => {
            try {
                const { id } = req.params;

                const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount === 0) return res.status(404).send({ message: "User not found" });

                res.send({ message: "User deleted successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });


        app.post("/login", async (req, res) => {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).send({ message: "All fields are required" });
            }

            // Find user
            const user = await usersCollection.findOne({ username });
            if (!user) {
                return res.status(401).send({ message: "Invalid username or password" });
            }

            // ⚠️ For production use bcrypt.compare instead of plain text
            if (user.password !== password) {
                return res.status(401).send({ message: "Invalid username or password" });
            }

            // ✅ Send full user data
            res.send({
                message: "Login successful",
                user: {
                    userId: user._id,
                    username: user.username,
                    balance: user.balance,
                    referCode: user.referCode,
                    sponsorId: user.sponsorId,
                    generation: user.generation,
                },
            });
        });


        app.post("/deposit", async (req, res) => {
            try {
                const { username, amount } = req.body;

                if (!username || !amount || parseFloat(amount) <= 0.1) {
                    return res.status(400).send({ message: "Invalid deposit data" });
                }

                const depositsCollection = client.db("megamart").collection("deposits");

                // Insert deposit record with status "pending"
                const depositData = {
                    username,
                    amount: parseFloat(amount),
                    status: "pending",
                    createdAt: new Date(),
                };

                await depositsCollection.insertOne(depositData);

                // Return success immediately without updating user balance yet
                res.send({ success: true, message: "Deposit recorded as pending" });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });

        // Get all deposits of a user
        app.get("/deposit/:username", async (req, res) => {
            const { username } = req.params;

            if (!username) {
                return res.status(400).send({ message: "Username is required" });
            }

            try {
                const deposits = await depositsCollection
                    .find({ username })
                    .sort({ timestamp: -1 }) // latest first
                    .toArray();

                res.send(deposits);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });


        app.post("/withdraw", async (req, res) => {
            try {
                const { userId, walletName, protocol, walletAddress, names, amount } = req.body;

                if (!userId || !walletName || !protocol || !walletAddress || !names || !amount) {
                    return res.status(400).send({ message: "All fields are required" });
                }

                const withdrawAmount = Number(amount);
                if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
                    return res.status(400).send({ message: "Invalid amount" });
                }

                const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
                if (!user) return res.status(404).send({ message: "User not found" });

                // Check user balance
                if (user.balance < withdrawAmount) {
                    return res.status(400).send({ message: "Insufficient balance" });
                }

                // Create withdraw request
                const withdrawRequest = {
                    userId: user._id,
                    walletName,
                    protocol,
                    walletAddress,
                    names,
                    amount: withdrawAmount,
                    status: "pending", // pending, approved, rejected
                    createdAt: new Date(),
                };

                const result = await withdrawCollection.insertOne(withdrawRequest);

                // Deduct balance immediately
                await usersCollection.updateOne(
                    { _id: user._id },
                    { $inc: { balance: -withdrawAmount } }
                );

                res.send({
                    message: "Withdraw request submitted successfully",
                    withdrawId: result.insertedId,
                    newBalance: user.balance - withdrawAmount, // optional, send new balance to frontend
                });

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Server error" });
            }
        });

        // Get all withdraw requests
        app.get("/withdraws", async (req, res) => {
            try {
                const withdraws = await withdrawCollection
                    .find({})
                    .sort({ createdAt: -1 }) // latest first
                    .toArray();

                res.send(withdraws);
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Server error" });
            }
        });


        // Approve withdraw
        app.put("/withdraws/:id/approve", async (req, res) => {
            try {
                const { id } = req.params;

                // Update withdraw status
                const result = await withdrawCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "success" } }
                );

                res.send({ message: "Withdraw approved", result });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });

        // Cancel withdraw (refund user balance)
        app.put("/withdraws/:id/cancel", async (req, res) => {
            try {
                const { id } = req.params;

                // Find withdraw request
                const withdraw = await withdrawCollection.findOne({ _id: new ObjectId(id) });
                if (!withdraw) return res.status(404).send({ message: "Withdraw not found" });

                // Refund balance
                await usersCollection.updateOne(
                    { _id: new ObjectId(withdraw.userId) },
                    { $inc: { balance: withdraw.amount } }
                );

                // Update status
                const result = await withdrawCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "cancelled" } }
                );

                res.send({ message: "Withdraw cancelled and amount refunded", result });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });


        // Withdraw records API
        app.get("/withdraw/:userId", async (req, res) => {
            try {
                const { userId } = req.params;

                // Validate userId
                if (!userId || !ObjectId.isValid(userId)) {
                    return res.status(400).send({ message: "Invalid userId" });
                }

                const records = await withdrawCollection
                    .find({ userId: new ObjectId(userId) })
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send(records);
            } catch (error) {
                console.error("Withdraw fetch error:", error);
                res.status(500).send({ message: "Server error" });
            }
        });






        app.get("/dashboard/stats", async (req, res) => {
            try {
                // Total users
                const usersCount = await usersCollection.countDocuments();

                // Total deposits
                const deposits = await depositsCollection.find().toArray();
                const totalDeposit = deposits.reduce((acc, tx) => acc + (tx.amount || 0), 0);

                // Total withdraws
                const withdraws = await withdrawCollection.find().toArray();
                const totalWithdraw = withdraws.reduce((acc, tx) => acc + (tx.amount || 0), 0);

                // Profit = Deposit - Withdraw
                const profit = totalDeposit - totalWithdraw;

                res.send({
                    users: usersCount,
                    totalDeposit,
                    totalWithdraw,
                    profit
                });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Server error" });
            }
        });


        // GET /dashboard/transactions
        app.get("/dashboard/transactions", async (req, res) => {
            try {
                // Fetch deposits
                const deposits = await depositsCollection.find().toArray();
                const depositTx = deposits.map(tx => ({
                    user: tx.username,
                    type: "Deposit",
                    amount: tx.amount,
                    status: tx.status,
                    createdAt: tx.createdAt
                }));

                // Fetch withdraws
                const withdraws = await withdrawCollection.find().toArray();

                // Map withdraws to include actual username
                const withdrawTx = await Promise.all(withdraws.map(async tx => {
                    const user = await usersCollection.findOne({ _id: new ObjectId(tx.userId) });
                    return {
                        user: user ? user.username : "Unknown",
                        type: "Withdraw",
                        amount: tx.amount,
                        status: tx.status,
                        createdAt: tx.createdAt
                    };
                }));

                // Combine and sort transactions by date
                const allTransactions = [...depositTx, ...withdrawTx].sort(
                    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
                );

                // Send latest 10 transactions
                res.send(allTransactions.slice(0, 10));
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Server error" });
            }
        });

        // PUT /deposits/:id → update deposit status
        app.put("/deposits/:id", async (req, res) => {
            try {
                const { id } = req.params;
                const { status } = req.body;

                if (!["pending", "success", "cancel"].includes(status)) {
                    return res.status(400).send({ message: "Invalid status" });
                }

                const depositsCollection = client.db("megamart").collection("deposits");
                const usersCollection = client.db("megamart").collection("users");

                // Find the deposit
                const deposit = await depositsCollection.findOne({ _id: new ObjectId(id) });
                if (!deposit) return res.status(404).send({ message: "Deposit not found" });

                // Update deposit status
                await depositsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status } }
                );

                // If approved, add amount to user's balance
                if (status === "success") {
                    await usersCollection.updateOne(
                        { username: deposit.username },
                        { $inc: { balance: deposit.amount } }
                    );
                }

                res.send({ message: `Deposit ${status} successfully` });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });


        // GET /deposits → get all deposits
        app.get("/deposits", async (req, res) => {
            try {
                const depositsCollection = client.db("megamart").collection("deposits");

                const deposits = await depositsCollection
                    .find()
                    .sort({ createdAt: -1 }) // latest first
                    .toArray();

                res.send(deposits);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });

        // GET /deposits/search?username=...
        app.get("/deposits/search", async (req, res) => {
            try {
                const { username } = req.query;
                if (!username) return res.status(400).send({ message: "Username query required" });

                const depositsCollection = client.db("megamart").collection("deposits");

                const deposits = await depositsCollection
                    .find({ username: { $regex: username, $options: "i" } }) // case-insensitive
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send(deposits);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });

        app.get("/plans", async (req, res) => {
            try {
                const plans = await plansCollection.find().toArray();
                res.send(plans);
            } catch (error) {
                console.error("Error fetching plans:", error);
                res.status(500).send({ message: "Server error" });
            }
        });

        app.put("/plans/:id", async (req, res) => {
            try {
                const { id } = req.params;
                const updatedPlan = req.body;
                const result = await plansCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedPlan }
                );
                res.send({ message: "Plan updated", result });
            } catch (error) {
                console.error("Error updating plan:", error);
                res.status(500).send({ message: "Server error" });
            }
        });

        // Delete plan
        app.delete("/plans/:id", async (req, res) => {
            try {
                const { id } = req.params;
                const result = await plansCollection.deleteOne({ _id: new ObjectId(id) });
                res.send({ message: "Plan deleted", result });
            } catch (error) {
                console.error("Error deleting plan:", error);
                res.status(500).send({ message: "Server error" });
            }
        });


        app.get("/wallets", async (req, res) => {
            try {
                const wallets = await walletsCollection.find().toArray();
                res.send(wallets);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });

        // Add new wallet
        app.post("/wallets", async (req, res) => {
            try {
                const { walletName, walletAddress, img } = req.body; // img added
                if (!walletName || !walletAddress) {
                    return res.status(400).send({ message: "Wallet name and address required" });
                }

                const result = await walletsCollection.insertOne({ walletName, walletAddress, img: img || null });
                res.send({ message: "Wallet added", result });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });

        // Update existing wallet
        app.put("/wallets/:id", async (req, res) => {
            try {
                const { id } = req.params;
                const { walletName, walletAddress, img } = req.body; // img added
                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: "Invalid wallet id" });
                }

                const updateData = { walletName, walletAddress };
                if (img) updateData.img = img; // update image only if provided

                const result = await walletsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updateData }
                );

                res.send({ message: "Wallet updated", result });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });

        app.delete("/wallets/:id", async (req, res) => {
            try {
                const { id } = req.params;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: "Invalid wallet id" });
                }

                const result = await walletsCollection.deleteOne({ _id: new ObjectId(id) });
                res.send({ message: "Wallet deleted", result });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });



        // GET: All products
        app.get("/products", async (req, res) => {
            try {
                const products = await productsCollection.find().toArray();
                res.send(products);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });
        app.post("/products", async (req, res) => {
            try {
                const { name, price, img } = req.body;

                if (!name || !price || !img) {
                    return res.status(400).send({ message: "All fields are required" });
                }

                const newProduct = { name, price, img };
                const result = await productsCollection.insertOne(newProduct);

                res.send({ success: true, productId: result.insertedId });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });

        // Delete a product by ID
        app.delete("/products/:id", async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: "Invalid product ID" });
                }

                const result = await productsCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: "Product not found" });
                }

                res.send({ success: true });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });


        app.post("/orders", async (req, res) => {
            try {
                const { userId, planId, amount } = req.body;
                if (!userId || !planId || !amount) {
                    return res.status(400).send({ error: "Missing fields" });
                }

                const newOrder = {
                    userId,
                    planId,
                    amount,
                    status: "pending",
                    createdAt: new Date(),
                };

                const result = await ordersCollection.insertOne(newOrder);
                res.send(result);
            } catch (err) {
                res.status(500).send({ error: err.message });
            }
        });

        // POST: Assign tasks to user
        app.post("/tasks/assign", async (req, res) => {
            const { userId, tasks } = req.body;
            try {
                const result = await tasksCollection.updateOne(
                    { userId },
                    { $push: { tasks: { $each: tasks } } },
                    { upsert: true }
                );
                res.send({ message: "Tasks assigned successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });

        // GET: Fetch user's tasks
        app.get("/tasks/:userId", async (req, res) => {
            try {
                const tasksDoc = await tasksCollection.findOne({ userId: req.params.userId });
                res.send(tasksDoc?.tasks || []);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });

        // PUT: Update user balance
        app.put("/users/update-balance", async (req, res) => {
            try {
                const { userId, deduct = 0, add = 0 } = req.body;

                if (!userId) return res.status(400).send({ message: "User ID is required" });

                const deductNum = Number(deduct);
                const addNum = Number(add);

                if (isNaN(deductNum) || isNaN(addNum))
                    return res.status(400).send({ message: "Deduct or Add must be a number" });

                const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
                if (!user) return res.status(404).send({ message: "User not found" });

                const currentBalance = Number(user.balance) || 0;

                if (deductNum > currentBalance)
                    return res.status(400).send({ message: "Insufficient balance" });

                const newBalance = currentBalance - deductNum + addNum;

                await usersCollection.updateOne(
                    { _id: new ObjectId(userId) },
                    { $set: { balance: newBalance } }
                );

                console.log("Balance updated:", newBalance);

                res.send({ balance: newBalance });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });

        // Make sure this comes AFTER update-balance
        app.put("/users/:id", async (req, res) => {
            try {
                const { id } = req.params;
                const { balance } = req.body;

                if (balance === undefined) return res.status(400).send({ message: "Balance is required" });

                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { balance: Number(balance) } }
                );

                if (result.matchedCount === 0) return res.status(404).send({ message: "User not found" });

                res.send({ message: "User updated successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });

        // PUT: Mark task as complete
        app.put("/tasks/:userId/:taskNumber", async (req, res) => {
            try {
                const { userId, taskNumber } = req.params;
                const { status } = req.body;

                if (!status) return res.status(400).send({ message: "Status is required" });

                const result = await tasksCollection.updateOne(
                    { userId, "tasks.taskNumber": parseInt(taskNumber) },
                    { $set: { "tasks.$.status": status } }
                );

                if (result.matchedCount === 0) return res.status(404).send({ message: "Task not found" });

                res.send({ message: "Task updated successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });

        app.get("/team/:userId", async (req, res) => {
            try {
                const { userId } = req.params;

                // Validate MongoDB ObjectId
                if (!ObjectId.isValid(userId)) {
                    return res.status(400).send({ message: "Invalid userId" });
                }

                // Fetch main user
                const user = await usersCollection.findOne(
                    { _id: new ObjectId(userId) },
                    { projection: { password: 0 } }
                );
                if (!user) return res.status(404).send({ message: "User not found" });

                // Extract generations
                const level1Users = user?.generation?.level1 || [];
                const level2Users = user?.generation?.level2 || [];
                const level3Users = user?.generation?.level3 || [];

                // All usernames including main user
                const allUsernames = [user.username, ...level1Users, ...level2Users, ...level3Users];

                // Fetch all team members
                const teamUsers = await usersCollection
                    .find({ username: { $in: allUsernames } })
                    .project({ username: 1, balance: 1 })
                    .toArray();

                // Map usernames → user objects
                const usernameToUser = {};
                teamUsers.forEach(u => {
                    usernameToUser[u.username] = u;
                });

                // Aggregate total balance
                const totalBalance = teamUsers.reduce((acc, u) => acc + (u.balance || 0), 0);

                // Get all userIds as string for deposits, withdraws, orders, tasks
                const allUserIds = teamUsers.map(u => u._id.toString());

                // Total deposits (only success)
                const deposits = await depositsCollection
                    .find({ username: { $in: allUsernames }, status: "success" })
                    .toArray();
                const totalDeposit = deposits.reduce((acc, tx) => acc + (tx.amount || 0), 0);

                // Total withdraws (only success)
                const withdraws = await withdrawCollection
                    .find({ userId: { $in: allUserIds }, status: "success" })
                    .toArray();
                const totalWithdraw = withdraws.reduce((acc, tx) => acc + (tx.amount || 0), 0);

                // Total orders amount
                const orders = await ordersCollection
                    .find({ userId: { $in: allUserIds } })
                    .toArray();
                const totalOrdersAmount = orders.reduce((acc, o) => acc + (o.amount || 0), 0);

                // Total commission from tasks
                const tasksDocs = await tasksCollection
                    .find({ userId: { $in: allUserIds } })
                    .toArray();
                const totalCommission = tasksDocs.reduce((acc, doc) => {
                    const tasks = doc.tasks || [];
                    const completedTasks = tasks.filter(t => t.status === "completed");
                    return acc + completedTasks.reduce((sum, t) => sum + (t.commission || 0), 0);
                }, 0);

                // Build users array with level info for frontend tabs
                const usersWithLevel = [];

                level1Users.forEach(username => {
                    if (usernameToUser[username]) {
                        usersWithLevel.push({ ...usernameToUser[username], level: 1 });
                    }
                });

                level2Users.forEach(username => {
                    if (usernameToUser[username]) {
                        usersWithLevel.push({ ...usernameToUser[username], level: 2 });
                    }
                });

                level3Users.forEach(username => {
                    if (usernameToUser[username]) {
                        usersWithLevel.push({ ...usernameToUser[username], level: 3 });
                    }
                });

                res.send({
                    user: {
                        userId: user._id,
                        username: user.username,
                        balance: user.balance,
                    },
                    team: {
                        level1: level1Users.length,
                        level2: level2Users.length,
                        level3: level3Users.length,
                        totalMembers: level1Users.length + level2Users.length + level3Users.length,
                        totalBalance,
                        totalDeposit,
                        totalWithdraw,
                        totalOrdersAmount,
                        totalCommission,
                        users: usersWithLevel, // added this
                    },
                });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Server error" });
            }
        });


       // supportCollection Routes

// ✅ Get current Telegram username
app.get("/support", async (req, res) => {
    try {
        const support = await supportCollection.findOne({});
        if (!support) return res.status(404).send({ message: "No customer service username set yet" });
        res.send(support);
    } catch (err) {
        console.error("GET /support error:", err);
        res.status(500).send({ message: "Server error" });
    }
});

// ✅ Add / Replace Telegram username (always keep only one document)
app.post("/support", async (req, res) => {
    const { telegramUsername } = req.body;
    if (!telegramUsername) return res.status(400).send({ message: "Telegram username is required" });

    try {
        // delete previous entry (always keep one)
        await supportCollection.deleteMany({});
        const result = await supportCollection.insertOne({
            telegramUsername,
            createdAt: new Date(),
        });

        res.send({ message: "Customer service username added", id: result.insertedId });
    } catch (err) {
        console.error("POST /support error:", err);
        res.status(500).send({ message: "Server error" });
    }
});

// ✅ Update Telegram username (safe)
app.put("/support/:id", async (req, res) => {
    const { telegramUsername } = req.body;
    const { id } = req.params;

    if (!telegramUsername) return res.status(400).send({ message: "Telegram username is required" });

    // check valid ObjectId
    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid ID format" });
    }

    try {
        const result = await supportCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { telegramUsername, updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({ message: "Support entry not found" });
        }

        if (result.modifiedCount === 0) {
            return res.status(200).send({ message: "No changes (username is same)" });
        }

        res.send({ message: "Customer service username updated" });
    } catch (err) {
        console.error("PUT /support error:", err);
        res.status(500).send({ message: "Server error" });
    }
});




        console.log("MongoDB Connected ✅");
    } catch (error) {
        console.error(error);
    }
}
run().catch(console.dir);

// Default Route
app.get("/", (req, res) => {
    res.send({ message: "Welcome to our server" });
});

// Start Server
app.listen(Port, () => {
    console.log(`Server running on http://localhost:${Port}`);
});
