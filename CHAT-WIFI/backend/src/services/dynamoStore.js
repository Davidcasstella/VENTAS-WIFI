/**
 * DynamoStore — Central DynamoDB abstraction layer
 *
 * Provides a simple interface for all services to read/write data to DynamoDB
 * instead of local JSON files. Uses single-table design with PK/SK pattern.
 *
 * Falls back to local JSON files when STORAGE_BACKEND !== 'dynamodb'.
 *
 * Table schema:
 *   PK (String) — partition key (e.g. "CONFIG", "CHAT#jid", "AI_RULE")
 *   SK (String) — sort key (e.g. "welcome-automation", "MSG#timestamp#id")
 *   data (Map)  — the actual payload
 */

const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = process.env.DYNAMO_TABLE_NAME || 'chatwifi-data';
const STORAGE_BACKEND = (process.env.STORAGE_BACKEND || 'local').toLowerCase();

let _client = null;
let _docClient = null;
let _tableReady = false;
let _tableCreatePromise = null;

/**
 * Check if DynamoDB storage is enabled.
 */
function isEnabled() {
    return STORAGE_BACKEND === 'dynamodb';
}

/**
 * Get the raw DynamoDB document client (lazy-initialized).
 */
function _getClient() {
    if (!_client) {
        _client = new DynamoDBClient({
            region: process.env.AWS_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
        });
        _docClient = DynamoDBDocumentClient.from(_client, {
            marshallOptions: {
                removeUndefinedValues: true,
                convertEmptyValues: true,
            },
        });
    }
    return _docClient;
}

/**
 * Ensure the DynamoDB table exists. Creates it if missing.
 * Only runs once; subsequent calls return immediately.
 */
async function ensureTable() {
    if (_tableReady) return;
    if (_tableCreatePromise) return _tableCreatePromise;

    _tableCreatePromise = (async () => {
        const client = _getClient();
        const rawClient = _client;

        try {
            await rawClient.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
            console.log(`✅ [DynamoDB] Table "${TABLE_NAME}" exists`);
            _tableReady = true;
        } catch (err) {
            if (err.name === 'ResourceNotFoundException') {
                console.log(`📦 [DynamoDB] Creating table "${TABLE_NAME}"...`);
                await rawClient.send(new CreateTableCommand({
                    TableName: TABLE_NAME,
                    KeySchema: [
                        { AttributeName: 'PK', KeyType: 'HASH' },
                        { AttributeName: 'SK', KeyType: 'RANGE' },
                    ],
                    AttributeDefinitions: [
                        { AttributeName: 'PK', AttributeType: 'S' },
                        { AttributeName: 'SK', AttributeType: 'S' },
                    ],
                    BillingMode: 'PAY_PER_REQUEST',
                }));

                // Wait for table to become active
                let retries = 0;
                while (retries < 30) {
                    await new Promise(r => setTimeout(r, 2000));
                    try {
                        const desc = await rawClient.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
                        if (desc.Table.TableStatus === 'ACTIVE') {
                            console.log(`✅ [DynamoDB] Table "${TABLE_NAME}" created and active`);
                            _tableReady = true;
                            return;
                        }
                    } catch (_) { /* keep waiting */ }
                    retries++;
                }
                throw new Error(`Table "${TABLE_NAME}" did not become active after 60s`);
            } else {
                throw err;
            }
        }
    })();

    return _tableCreatePromise;
}

// ── CRUD Operations ──────────────────────────────────────────────────────

/**
 * Get a single item by PK + SK.
 * @returns {object|null} The item's data, or null if not found.
 */
async function getItem(pk, sk) {
    await ensureTable();
    const client = _getClient();
    const result = await client.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: sk },
    }));
    return result.Item ? result.Item.data : null;
}

/**
 * Put (upsert) a single item.
 * @param {string} pk - Partition key
 * @param {string} sk - Sort key
 * @param {object} data - The payload to store
 */
async function putItem(pk, sk, data) {
    await ensureTable();
    const client = _getClient();
    await client.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: pk, SK: sk, data, updatedAt: new Date().toISOString() },
    }));
}

/**
 * Delete a single item.
 */
async function deleteItem(pk, sk) {
    await ensureTable();
    const client = _getClient();
    await client.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: sk },
    }));
}

/**
 * Query all items with a given PK (and optional SK prefix).
 * @param {string} pk - Partition key
 * @param {string} [skPrefix] - Optional SK prefix to filter (begins_with)
 * @returns {Array<object>} Array of { sk, data } objects
 */
async function queryItems(pk, skPrefix) {
    await ensureTable();
    const client = _getClient();

    const params = {
        TableName: TABLE_NAME,
        KeyConditionExpression: skPrefix
            ? 'PK = :pk AND begins_with(SK, :skp)'
            : 'PK = :pk',
        ExpressionAttributeValues: { ':pk': pk },
    };
    if (skPrefix) {
        params.ExpressionAttributeValues[':skp'] = skPrefix;
    }

    const items = [];
    let lastKey = undefined;

    do {
        if (lastKey) params.ExclusiveStartKey = lastKey;
        const result = await client.send(new QueryCommand(params));
        for (const item of (result.Items || [])) {
            items.push({ sk: item.SK, data: item.data });
        }
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return items;
}

/**
 * Scan all items with a given PK (using filter).
 * Less efficient than query but useful for certain patterns.
 * Prefer queryItems when possible.
 */
async function scanByPK(pk) {
    await ensureTable();
    const client = _getClient();

    const params = {
        TableName: TABLE_NAME,
        FilterExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': pk },
    };

    const items = [];
    let lastKey = undefined;

    do {
        if (lastKey) params.ExclusiveStartKey = lastKey;
        const result = await client.send(new ScanCommand(params));
        for (const item of (result.Items || [])) {
            items.push({ sk: item.SK, data: item.data });
        }
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return items;
}

/**
 * Batch write up to 25 items at a time.
 * @param {Array<{pk, sk, data}>} items - Items to write
 */
async function batchPut(items) {
    await ensureTable();
    const client = _getClient();

    // DynamoDB BatchWrite has a 25-item limit per call
    const chunks = [];
    for (let i = 0; i < items.length; i += 25) {
        chunks.push(items.slice(i, i + 25));
    }

    for (const chunk of chunks) {
        const requestItems = chunk.map(item => ({
            PutRequest: {
                Item: {
                    PK: item.pk,
                    SK: item.sk,
                    data: item.data,
                    updatedAt: new Date().toISOString(),
                },
            },
        }));

        await client.send(new BatchWriteCommand({
            RequestItems: { [TABLE_NAME]: requestItems },
        }));
    }
}

/**
 * Delete all items with a given PK (query + batch delete).
 */
async function deleteAllByPK(pk) {
    const items = await queryItems(pk);
    if (items.length === 0) return;

    const client = _getClient();
    const chunks = [];
    for (let i = 0; i < items.length; i += 25) {
        chunks.push(items.slice(i, i + 25));
    }

    for (const chunk of chunks) {
        const requestItems = chunk.map(item => ({
            DeleteRequest: {
                Key: { PK: pk, SK: item.sk },
            },
        }));

        await client.send(new BatchWriteCommand({
            RequestItems: { [TABLE_NAME]: requestItems },
        }));
    }
}

module.exports = {
    isEnabled,
    ensureTable,
    getItem,
    putItem,
    deleteItem,
    queryItems,
    scanByPK,
    batchPut,
    deleteAllByPK,
    TABLE_NAME,
};
