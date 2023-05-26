'use strict';

const { Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const { Gateway, X509WalletMixin } = require('fabric-network');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');


// get the configuration
const configPath = path.join(process.cwd(), './config.json');
const configJSON = fs.readFileSync(configPath, 'utf8');
const config = JSON.parse(configJSON);
require('dotenv').config();

// let userName = config.userName;
let gatewayDiscovery = config.gatewayDiscovery;
let appAdmin = config.appAdmin;

// connect to the connection file
const ccpPath = path.resolve(process.env.FABRIC_PATH, process.env.CONFIG_CONNECTION_PROFILE);
const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

exports.getAdminUser = async function () {
    return appAdmin;
}

exports.registerUser = async function (userId, name, role) {

    if (!userId || !name || !role) {
        let response = {};
        response.error = 'all fields are mandatory';
        return response;
    }

    try {
        // Create a new file system based wallet for managing identities.
        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);

        // Check to see if we've already enrolled the user.
        const userCheck = await wallet.get(userId);
        if (userCheck) {
            let response = { error : `Error! An identity for the user ${userId} already exists in the wallet. Please enter a different id` };
            return response;
        }

        // Check to see if we've already enrolled the admin user.
        const adminIdentity = await wallet.get(appAdmin);
        if (!adminIdentity) {
            let response = { error : `An identity for the admin user ${appAdmin} does not exist in the wallet` };
            return response;
        }

        // Create a new gateway for connecting to our peer node.
        // const gateway = new Gateway();
        // await gateway.connect(ccp, { wallet, identity: appAdmin, discovery: gatewayDiscovery });

        // Create a new CA client for interacting with the CA.
        const caURL = ccp.certificateAuthorities[process.env.CONFIG_CA_NAME].url;
        const ca = new FabricCAServices(caURL);

        // build a user object for authenticating with the CA
        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, 'admin');

        // const adminIdentity = gateway.getCurrentIdentity();

        const user = { affiliation: process.env.CONFIG_ORG, enrollmentID: userId, role: 'client',
            attrs: [{ name: 'id', value: userId, ecert: true },
                { name: 'name', value: name, ecert: true },
                { name: 'role'  , value: role, ecert: true }] };

        // Register the user, enroll the user, and import the new identity into the wallet.
        const secret = await ca.register(user, adminUser);

        const enrollmentData = {
            enrollmentID: userId,
            enrollmentSecret: secret,
            attr_reqs: [{ name: "id", optional: false },
                { name: "name", optional: false },
                { name: "role", optional: false }]
        };

        const enrollment = await ca.enroll(enrollmentData);

        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: process.env.CONFIG_MSPID,
            type: 'X.509',
        };
        await wallet.put(userId, x509Identity);

        let response = `Successfully registered user ${name}. Use userId ${userId} to login above.`;
        return response;
    } catch (error) {
        let response = { error: 'the following errors ocurred: ' + error.message? error.message : error};
        return response;
    }
};

exports.connectToNetwork = async function (userName) {
    const gateway = new Gateway();

    try {
        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);

        const userCheck = await wallet.get(userName);
        if (!userCheck) {
            console.log('An identity for the user ' + userName + ' does not exist in the wallet');
            let response = { error: 'An identity for the user ' + userName + ' does not exist in the wallet. Register ' + userName + ' first' };
            return response;
        }

        await gateway.connect(ccp, { wallet, identity: userName, discovery: gatewayDiscovery });

        // Connect to our local fabric
        const network = await gateway.getNetwork('mychannel');

        // Get the contract we have installed on the peer
        const notaryContract = await network.getContract('notary-chaincode', 'NotaryContract');
        const policyContract = await network.getContract('notary-chaincode', 'PolicyContract');
        const identityContract = await network.getContract('notary-chaincode', 'IdentityContract');

        let networkObj = {
            contracts: [
                notaryContract,
                policyContract,
                identityContract
            ],
            network: network,
            gateway: gateway
        };

        return networkObj;

    } catch (error) {
        let response = { error: 'the following errors ocurred: ' + error.message? error.message : error};
        return response;
    } finally {
        console.log('Done connecting to network.');
    }
};

exports.createParticipant = async function (networkObj, id, name, role) {
    try {

        let response = await networkObj.contracts
            .find((contract) => contract.namespace === 'IdentityContract')
            .submitTransaction('createParticipant', id, name, role);
        await networkObj.gateway.disconnect();
        return response.toString();
    } catch (error) {
        console.log('error',error);
        let response = { error: 'the following errors ocurred: ' };
        for (var key in error) {
            response.error += key + ' - ' + error[key];
        }
        return response;
    }
};

exports.getParticipant = async function (networkObj, participantId) {
    try {
        let response = await networkObj.contracts
            .find((contract) => contract.namespace === 'IdentityContract')
            .evaluateTransaction('getParticipant', participantId);
        await networkObj.gateway.disconnect();
        return response.toString();
    } catch (error) {
        console.log(error);
        let response = { error: 'the following errors ocurred: ' };
        for (var key in error) {
            response.error += key + ' - ' + error[key];
        }
        return response;
    }
};


exports.addNotaryLog = async function (networkObj, participantId, type, text) {
    try {
        const timestamp = Date.now().toString();
        let idLog = uuidv4();
        console.log(idLog)

        let response = await networkObj.contracts
            .find((contract) => contract.namespace === 'NotaryContract')
            .submitTransaction('addNotaryLog', idLog, participantId, timestamp, type, text);
        await networkObj.gateway.disconnect();
        return response.toString();
    } catch (error) {
        let response = { error: 'the following errors ocurred: ' + error.message? error.message : error};
        return response;
    }
};

exports.getNotaryLog = async function (networkObj, id) {
    try {
        let response = await networkObj.contracts
            .find((contract) => contract.namespace === 'NotaryContract')
            .submitTransaction('getNotaryLog', id);
        await networkObj.gateway.disconnect();
        return response.toString();
    } catch (error) {
        let response = { error: 'the following errors ocurred: ' + error.message? error.message : error};
        return response;
    }
};

exports.getAllNotaryLogs = async function (networkObj) {
    try {
        let response = await networkObj.contracts
            .find((contract) => contract.namespace === 'NotaryContract')
            .submitTransaction('getAllNotaryLogs');
        await networkObj.gateway.disconnect();
        return response.toString();
    } catch (error) {
        let response = { error: 'the following errors ocurred: ' + error.message? error.message : error};
        return response;
    }
};