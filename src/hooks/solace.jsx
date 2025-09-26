import { useState } from "react";
import solace from '../utils/solace/solclientasync';

import { useSempApi } from "../providers/SempClientProvider";

const PAGE_SIZE = 100;
const MIN_MSG_ID = 1n;
const MAX_MSG_ID = 9223372036854775808n;

export const SOURCE_TYPE = {
  BASIC: 'basic',
  QUEUE: 'queue',
  TOPIC: 'topic'
};

export const BROWSE_MODE = {
  BASIC: 'basic',
  HEAD: 'head',
  TAIL: 'tail',
  TIME: 'time',
  MSGID: 'msgid'
};

export const SUPPORTED_BROWSE_MODES = {
  [SOURCE_TYPE.BASIC]: [
    BROWSE_MODE.BASIC
  ],
  [SOURCE_TYPE.QUEUE]: [
    BROWSE_MODE.BASIC,
    BROWSE_MODE.HEAD,
    BROWSE_MODE.TAIL,
    BROWSE_MODE.TIME,
    BROWSE_MODE.MSGID
  ],
  [SOURCE_TYPE.TOPIC]: [
    BROWSE_MODE.TIME,
    BROWSE_MODE.MSGID
  ]
}

export const MESSAGE_ORDER = {
  OLDEST: 'oldest',   // Forward Browsing
  NEWEST: 'newest'    // Reverse Browsing
};

const BROWSER_STATE = {
  CLOSED: 'closed',
  OPENING: 'opening',
  OPEN: 'open',
  CLOSING: 'closing'
};
 
class BaseBrowser {
  constructor({ sourceDefinition, startFrom, sempApi, solclientFactory } = {}) {
    this.instanceId = `${this.constructor.name} ${Math.random().toString().substring(2,6)}`;
    // Specific browser instance behavior
    this.sourceDefinition = sourceDefinition;
    this.startFrom = startFrom;

    // Core API
    this.sempApi = sempApi;
    this.solclientFactory = solclientFactory;

    // Defined in open()
    this.vpn = undefined;
    this.sempClient = undefined;
    this.session = undefined;
    this.replayLogName = undefined;
    this.topics = undefined;

    // Page management
    this.nextPage = null;
    this.prevPages = [];
    this.pageSize = PAGE_SIZE;

    this.state = BROWSER_STATE.CLOSED;
  }

  async open() {
    this.assertState(BROWSER_STATE.CLOSED);
    this.state = BROWSER_STATE.OPENING;

    const { sourceName, config, topics } = this.sourceDefinition || {};
    const {
      hostName, clientPort, useTls, vpn,
      clientUsername, clientPassword
    } = config || {};

    this.vpn = vpn;

    if (this.sempApi) {
      this.sempClient = this.sempApi?.getClient(config);
    }

    if (this.solclientFactory) {
      this.session = this.solclientFactory.createAsyncSession({
        url: `${(useTls ? 'wss' : 'ws')}://${hostName}:${clientPort}`,
        vpnName: this.vpn,
        userName: clientUsername,
        password: clientPassword
      });
    }

    const { data: [{ replayLogName } = {}] } = await this.sempClient.getMsgVpnReplayLogs(this.vpn, { select: ['replayLogName'] });
    this.replayLogName = replayLogName;

    this.assertState(BROWSER_STATE.OPENING);

    if (topics) {
      this.topics = topics;
    } else {
      const { data: { networkTopic } } = await this.sempClient.getMsgVpnQueue(this.vpn, sourceName, { select: ['networkTopic'] });
      const { data: subscriptions } = await this.sempClient.getMsgVpnQueueSubscriptions(this.vpn, sourceName);

      this.topics = [
        networkTopic,
        ...subscriptions.map(s => s.subscriptionTopic)
      ];
    }

    this.assertState(BROWSER_STATE.OPENING);
    this.state = BROWSER_STATE.OPEN;
  }

  async close() { 
    this.state = BROWSER_STATE.CLOSED;
    this.assertState(BROWSER_STATE.CLOSED);
  }


  assertState(state) {
    if(this.state !== state) {
      throw new Error(`[${this.instanceId}] Invalid state: expected '${state}', current value '${this.state}'`);
    }
  }

  getFirstPage() {
    this.prevPages.length = 0;
    return this.getPage(this.startFrom);
  }

  getNextPage() {
    return this.getPage(this.nextPage);
  }

  getPrevPage() {
    this.prevPages.pop();
    return this.getPage(this.prevPages.pop())
  }

  hasNextPage() {
    return (this.nextPage !== null);
  }

  hasPrevPage() {
    return (this.prevPages.length > 1);
  }

  async getPage(page) {
    return [];
  }

  async getMessageMetaData({ queueName, fromMsgId = null, direction, count = this.pageSize }) {
    const cursor = (fromMsgId !== null) ? [
      `<rpc><show><queue>`,
      `<name>${queueName}</name>`,
      `<vpn-name>${this.vpn}</vpn-name>`,
      `<messages/><${direction}/>`,
      `<msg-id>${fromMsgId}</msg-id>`,
      `<detail/><count/>`,
      `<num-elements>${count}</num-elements>`,
      `</queue></show></rpc>`
    ].join('') : undefined;

    const { data: msgMetaData } = await this.sempClient
      .getMsgVpnQueueMsgs(this.vpn, queueName, { cursor, count });

    return msgMetaData;
  }

  async replayToTempQueue({ sourceName, replayFrom, count = this.pageSize }) {
    await this.session.connect();

    const tempQueueName = `#QB/${sourceName}/${Date.now()}`;
    const queueDescriptor = { name: tempQueueName, type: solace.QueueType.QUEUE };

    await this.session.provisionEndpoint(queueDescriptor, {}, true);

    const messageConsumer = this.session.createMessageConsumer({
      queueDescriptor,
      acknowledgeMode: solace.MessageConsumerAcknowledgeMode.CLIENT,
      windowSize: 1,
      replayStartLocation:
        replayFrom?.afterMsg ? this.solclientFactory.createReplicationGroupMessageId(replayFrom.afterMsg) :
          replayFrom?.fromTime ? this.solclientFactory.createReplayStartLocationDate(new Date(replayFrom.fromTime * 1000)) :
            replayFrom ? this.solclientFactory.createReplayStartLocationBeginning() :
              null
    });

    await Promise.all(this.topics.map(topic => (
      messageConsumer.addSubscription(
        this.solclientFactory.createTopicDestination(topic),
        topic,
        2000
      )))
    );

    const receivedMessages = [];
  
    messageConsumer.on(solace.MessageConsumerEventName.MESSAGE, message => {
      receivedMessages.push(message);
      if (receivedMessages.length >= count) {
        done = true;
      }
    });
  
    await messageConsumer.connect();
  
    const timeout = 500;
    const interval = 100;
    const startTime = Date.now();
    let done = false;
  
    while (!done && (Date.now() - startTime) < timeout) {
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  
    await messageConsumer.disconnect();
  
    const queueBrowser = this.session.createQueueBrowser({ queueDescriptor });
    const [, messages] = await Promise.all([
      queueBrowser.connect(),
      queueBrowser.readMessages(count, 500)
    ]);
    await queueBrowser.disconnect();
  
    return {
      messages,
      tempQueueName,
      cleanupReplay: async () => {
        try {
          await this.session.deprovisionEndpoint(queueDescriptor);
          await this.session.disconnect();
        } catch (err) {
          console.warn("⚠️ Error cleaning replay:", err.message);
        }
      }
    };
  }  

  async getQueueReplayFrom({ messageId }) {
    try {
      const cursor = [
        `<rpc><show><replay-log>`,
        `<name>${this.replayLogName}</name>`,
        `<vpn-name>${this.vpn}</vpn-name>`,
        `<messages/><newest/>`,
        `<msg-id>${messageId}</msg-id>`,
        `<detail/>`,
        `<num-elements>2</num-elements>`,
        `</replay-log></show></rpc>`,
      ].join('');

      const { data: msgMetaData } = await this.sempClient
        .getMsgVpnReplayLogMsgs(this.vpn, this.replayLogName, { cursor, count: 2 });
      if (msgMetaData.length >= 2) {
        const [, nextOldestMessage] = msgMetaData;
        return ({
          afterMsg: nextOldestMessage.replicationGroupMsgId
        });
      } else {
        console.warn(`[getQueueReplayFrom] msgMetaData has less than 2 elements for messageId: ${messageId}`);
        return {};
      }
    } catch (ex) {
      console.warn('Unable to find a suitable RGMID to start from. Will replay from beginning of time.', ex);
      return {};
    }
  }

  async getReplayTimeRange() {
    if(!this.replayLogName) {
      return { max: null, min: null };
    }
    try {
      const minMaxSpooledTime = await Promise.all([
        this.sempClient.getMsgVpnReplayLogMsgs(this.vpn, this.replayLogName, {
          cursor: [
            `<rpc><show><replay-log>`,
            `<name>${this.replayLogName}</name>`,
            `<vpn-name>${this.vpn}</vpn-name>`,
            `<messages/><oldest/>`,
            `<msg-id>${MIN_MSG_ID}</msg-id>`,
            `<detail/>`,
            `<num-elements>1</num-elements>`,
            `</replay-log></show></rpc>`,
          ].join(''),
          select: ['spooledTime'],
          count: 1
        }).then(({ data: [{ spooledTime }] }) => ['min', spooledTime]).catch(() => ['min', null]),
        this.sempClient.getMsgVpnReplayLogMsgs(this.vpn, this.replayLogName, {
          cursor: [
            `<rpc><show><replay-log>`,
            `<name>${this.replayLogName}</name>`,
            `<vpn-name>${this.vpn}</vpn-name>`,
            `<messages/><newest/>`,
            `<msg-id>${MAX_MSG_ID}</msg-id>`,
            `<detail/>`,
            `<num-elements>1</num-elements>`,
            `</replay-log></show></rpc>`,
          ].join(''),
          select: ['spooledTime'],
          count: 1
        }).then(({ data: [{ spooledTime }] }) => ['max', spooledTime]).catch(() => ['max', null]),
      ]);
      return Object.fromEntries(minMaxSpooledTime);
    } catch (ex) {
      return { min: null, max: null };
    }
  }

  merge({ messages, msgMetaData }) {
    const messageIdx = new Map(msgMetaData.map(meta => ([meta.replicationGroupMsgId, { meta }])));
    messages.forEach(msg => {
      const msgObj = {
        payload: msg.getSdtContainer()?.getValue() || msg.getBinaryAttachment().toString(),
        headers: {
          destination: msg.getDestination().getName(),
          replicationGroupMsgId: msg.getReplicationGroupMessageId().toString(),
          guaranteedMessageId: msg.getGuaranteedMessageId()?.low,
          applicationMessageId: msg.getApplicationMessageId(),
          applicationMessageType: msg.getApplicationMessageType(),
          correlationId: msg.getCorrelationId(),
          deliveryMode: ['Direct', 'Persistent', 'Non-Persistent'][msg.getDeliveryMode()],
          replyTo: msg.getReplyTo(),
          senderId: msg.getSenderId(),
          senderTimestamp: msg.getSenderTimestamp(),
          sequenceNumber: msg.getSequenceNumber()
        },
        userProperties: Object.fromEntries((msg.getUserPropertyMap()?.getKeys() || []).map(key => {
          return [key, msg.getUserPropertyMap().getField(key).getValue()]
        }))
      };
      const metaData = messageIdx.get(msgObj.headers.replicationGroupMsgId);
      if (metaData) {
        Object.assign(metaData, msgObj);
      }
    });
    return [...messageIdx.values()];
  }
}

class LoggedMessagesReplayBrowser extends BaseBrowser {
  constructor({ sourceDefinition, startFrom, sempApi, solclientFactory }) {
    super({ sourceDefinition, sempApi, solclientFactory });
    this.startFrom = startFrom;
  }

  async getPage(page) {
    const { fromMsgId } = page || {};
    const { sourceName } = this.sourceDefinition;
    const count = this.pageSize;

    const replayFrom = fromMsgId ? await this.getQueueReplayFrom({ messageId: fromMsgId }) : page;
    const { tempQueueName, messages, cleanupReplay } = await this.replayToTempQueue({ sourceName, replayFrom });
    const msgMetaData =
      await this.getMessageMetaData({
        queueName: tempQueueName,
        fromMsgId,
        direction: MESSAGE_ORDER.OLDEST,
        count
      });

    const { data: tempQueue } = await this.sempClient.getMsgVpnQueue(this.vpn, tempQueueName);
    cleanupReplay();

    if (msgMetaData.length === 0) {
      return [];
    }

    const highestMsgId = msgMetaData[msgMetaData.length - 1]?.msgId;

    this.nextPage =
      (tempQueue.spooledMsgCount > count) ? ({ fromMsgId: highestMsgId + 1 }) : null;
    this.prevPages.push({ fromMsgId });

    return this.merge({ messages, msgMetaData });
  }
}

class QueuedMessagesReplayBrowser extends BaseBrowser {
  constructor({ sourceDefinition, startFrom, sempApi, solclientFactory }) {
    const messageOrderBy = startFrom?.queuePosition;
    const isReversed = (messageOrderBy === MESSAGE_ORDER.NEWEST);

    super({
      sourceDefinition,
      startFrom: { fromMsgId: isReversed ? MAX_MSG_ID : MIN_MSG_ID },
      sempApi,
      solclientFactory
    });

    this.messageOrderBy = messageOrderBy;
    this.isReversed = isReversed;
  }

  async getPage(page) {
    const { fromMsgId } = page || {};
    const { sourceName } = this.sourceDefinition;
    const count = this.pageSize;
    const msgMetaData =
      await this.getMessageMetaData({
        queueName: sourceName,
        fromMsgId,
        direction: this.messageOrderBy,
        count
      });
    if (msgMetaData.length === 0) {
      return [];
    }

    const { data: queue } = await this.sempClient.getMsgVpnQueue(this.vpn, sourceName);

    const lowestMsgId = msgMetaData[this.isReversed ? (msgMetaData.length - 1) : 0].msgId;
    const highestMsgId = msgMetaData[this.isReversed ? 0 : (msgMetaData.length - 1)].msgId;

    const replayFrom = await this.getQueueReplayFrom({ messageId: lowestMsgId });
    const { messages, cleanupReplay } = await this.replayToTempQueue({ sourceName, replayFrom, count: msgMetaData.length });
    cleanupReplay();

    this.nextPage = this.isReversed ?
      ((lowestMsgId > queue.lowestMsgId) ? ({ fromMsgId: lowestMsgId - 1 }) : null) :
      ((highestMsgId < queue.highestMsgId) ? ({ fromMsgId: highestMsgId + 1 }) : null);
    this.prevPages.push({ fromMsgId });

    return this.merge({ messages, msgMetaData });
  }
}

class BasicQueueBrowser extends BaseBrowser {
  constructor({ sourceDefinition, sempApi, solclientFactory }) {
    super({ sourceDefinition, sempApi, solclientFactory });

    this.didReadMessages = false;
  }

  hasPrevPage() {
    return false;
  }

  async open() {
    const { sourceName: queueName } = this.sourceDefinition;

    await super.open();
    this.state = BROWSER_STATE.OPENING; // reset OPEN state to continue async operations
    
    await this.session.connect();
    this.assertState(BROWSER_STATE.OPENING);

    const queueDescriptor = { name: queueName, type: solace.QueueType.QUEUE };
    this.queueBrowser = this.session.createQueueBrowser({ queueDescriptor });
    await this.queueBrowser.connect();
    this.assertState(BROWSER_STATE.OPENING);
    this.nextPage = { basic: true };
    this.state = BROWSER_STATE.OPEN;
  }
  async close() {
    this.state = BROWSER_STATE.CLOSING;

    this.queueBrowser?.disconnect();
    this.session?.disconnect();

    this.assertState(BROWSER_STATE.CLOSING);
    this.state = BROWSER_STATE.CLOSED;
  }

  async getPage() {
    const { sourceName: queueName } = this.sourceDefinition;
    const messages = await this.queueBrowser.readMessages(this.pageSize, 500);

    if (messages.length === 0) {
      this.nextPage = null;
      return [];
    }

    const fromMsgId = messages[0].getGuaranteedMessageId()?.low;
    const msgMetaData =
      await this.getMessageMetaData({
        queueName,
        fromMsgId,
        direction: MESSAGE_ORDER.OLDEST,
        count: messages.length
      });

    this.prevPages.push({ fromMsgId });
    this.didReadMessages = true;
    
    this.nextPage = (messages.length < this.pageSize) ? null : { basic: true };
    return this.merge({ messages, msgMetaData });
  }

  async getFirstPage() {
    if(this.didReadMessages) {
      await this.close();
      await this.open();
      this.didReadMessages = false;
    }
    return await this.getPage();
  }
}

class NullBrowser extends BaseBrowser{
  async open() {}
  async close() {}
  async getPage() {return []};
}

const NULL_BROWSER = new NullBrowser();

export function useQueueBrowsing() {
  const [browser, setBrowser] = useState(NULL_BROWSER);
  const sempApi = useSempApi();

  const updateBrowser = async (sourceDefinition, browseFrom) => {
    const solclientFactory = solace.SolclientFactory;
    const { type } = sourceDefinition;
    const { browseMode, startFrom = {}} = browseFrom;

    const newBrowser = (type) ? (
      (browseMode === BROWSE_MODE.BASIC || type === SOURCE_TYPE.BASIC) ?
        new BasicQueueBrowser({ sourceDefinition, startFrom, sempApi, solclientFactory }) :
        (browseMode === BROWSE_MODE.HEAD || browseMode === BROWSE_MODE.TAIL) ?
          new QueuedMessagesReplayBrowser({ sourceDefinition, startFrom, sempApi, solclientFactory }) :
          new LoggedMessagesReplayBrowser({ sourceDefinition, startFrom, sempApi, solclientFactory })
    ) : NULL_BROWSER;
    try {
      await browser?.close();
    } catch (err) {
      console.error('Error closing browser', err);
    }
    try {
      await newBrowser?.open();
      setBrowser(newBrowser);
    } catch (err) {
      console.error('Error opening browser', err);
      setBrowser(NULL_BROWSER);
    }
  }

  return [browser, updateBrowser];
}