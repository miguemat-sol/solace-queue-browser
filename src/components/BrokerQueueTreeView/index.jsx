import { useState } from 'react';
import { useSempApi } from '../../providers/SempClientProvider';

import { Tree } from 'primereact/tree';

import ContentPanel from '../ContentPanel';
import BrokerConfigDialog from '../BrokerConfigDialog';
import ReplayTopicDialog from '../ReplayTopicDialog';

import { TopicIcon, LvqIcon, QueueIcon } from '../../icons';

import classes from './styles.module.css';

export default function TreeView({ brokers, brokerEditor, onSourceSelected }) {
  const [brokerForConfig, setBrokerForConfig] = useState(null);
  const [brokerAndReplayTopic, setBrokerAndReplayTopic] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const [queuesListMap, setQueuesListMap] = useState({});
  const [topicsListMap, setTopicsListMap] = useState({});

  const sempApi = useSempApi();

  const getBrokerIcon = (testResult) => (
    testResult ? (
      testResult.connected ? (
        testResult.replay ?
          'pi pi-circle-fill text-primary' :
          'pi pi-circle text-primary'
      ) :
        'pi pi-times-circle text-red-500'
    ) : 'pi pi-question-circle'
  );

  const getQueueIcon = (queue) => {
    const isLvq = queue.maxMsgSpoolUsage === 0;
    const isEmpty = queue.msgSpoolUsage === 0;
    const isFull = (queue.msgSpoolUsage / queue.maxMsgSpoolUsage) > queue.eventMsgSpoolUsageThreshold.setPercent;

    const iconColor = isEmpty ? '' : (!isLvq && isFull) ? 'text-red-500' : 'text-primary';
    return isLvq ?
      <LvqIcon size="16" className={iconColor} /> :
      <QueueIcon size="16" className={iconColor} />;
  };

  const nodes = [...brokers.map(config => ({
    id: config.id,
    key: config.id,
    label: config.displayName,
    data: {
      type: 'broker',
      toolIcon: 'pi pi-ellipsis-h',
      onToolClick: () => setBrokerForConfig(config),
      config
    },
    icon: getBrokerIcon(config.testResult),
    leaf: false,
    children: [
      {
        id: `${config.id}/queues`,
        key: `${config.id}/queues`,
        label: 'Queues',
        icon: <QueueIcon size="16" />,
        data: {
          type: 'queues',
          toolIcon: '',
          config
        },
        leaf: false,
        children: queuesListMap[config.id] || []
      },
      ...(config.testResult?.replay ? [{
        id: `${config.id}/topics`,
        key: `${config.id}/topics`,
        label: 'Replay Log',
        icon: 'pi pi-backward',
        data: {
          type: 'topics',
          toolIcon: 'pi pi-plus',
          onToolClick: () => { setBrokerAndReplayTopic({ broker: config, replayTopic: null }) },
          config
        },
        leaf: false,
        children: topicsListMap[config.id] || []
      }] : [])
    ]
  })),
  ];

  const buildQueueNodeList = (config, queues) => {
    return queues
      .filter((queue) => !queue.queueName.startsWith('#'))
      .map((queue, n) => ({
        id: `${config.id}/queue/${n}`,
        key: `queue/${n}`,
        label: queue.queueName,
        data: {
          type: 'queue',
          toolIcon: '',
          config,
          sourceName: queue.queueName
        },
        icon: getQueueIcon(queue)
      }));
  };

  const buildTopicNodeList = (config) => {
    const { replayTopics = [] } = config;
    return replayTopics
      .map((replayTopic, n) => ({
        id: `${config.id}/topic/${n}`,
        key: `topic/${n}`,
        label: replayTopic.subscriptionName,
        icon: <TopicIcon />,
        data: {
          type: 'topic',
          toolIcon: 'pi pi-ellipsis-h',
          onToolClick: () => setBrokerAndReplayTopic({ broker: config, replayTopic }),
          config,
          sourceName: replayTopic.subscriptionName,
          topics: replayTopic.topics
        }
      }));
  }

  const handleExpand = async (event) => {
    console.log('handleExpand', event.node);
    const { node } = event;
    const { type, config } = node.data;

    if (type === 'broker') {
      setIsLoading(true);
      const { result } = await brokerEditor.test(config);
      Object.assign(config, { testResult: result }); //HACK: this updates the during each expansion
      setIsLoading(false);
      return;
    }

    if (type === 'queues' && config.testResult.connected) {
      setIsLoading(true);
      const { data: queues } = await sempApi.getClient(config).getMsgVpnQueues(config.vpn, { count: 100 });
      const queueNodeList = buildQueueNodeList(config, queues);
      setQueuesListMap(prev => ({ ...prev, [config.id]: queueNodeList }));
      setIsLoading(false);
    }

    if (type === 'topics' && config.testResult.connected) {
      const topicNodeList = buildTopicNodeList(config);
      setTopicsListMap(prev => ({ ...prev, [config.id]: topicNodeList }));
    }
  };

  const handleSelect = (event) => {
    console.log('handleSelect', event.node.data);
    if (event.node.data.type === 'queue' || event.node.data.type === 'topic') {
      onSourceSelected?.(event.node.data);
    }
  };

  const handleAddBrokerClick = () => {
    setBrokerForConfig({});
  };

  const handleConfigHide = (data) => {
    setBrokerForConfig(null);
  };

  const handleTopicDialogHide = (data) => {
    const { broker } = brokerAndReplayTopic;
    const topicNodeList = buildTopicNodeList(broker);
    setTopicsListMap(prev => ({ ...prev, [broker.id]: topicNodeList }));
    setBrokerAndReplayTopic(null);
  };

  const nodeTemplate = (node, options) => {
    const handleClick = (evt) => {
      evt.stopPropagation();
      node.data.onToolClick && node.data.onToolClick();
    };
    return (
      <div className={`${options.className} ${classes.treeNodeLabel}`}>
        <div style={{ flex: '1' }}>{node.label}</div>
        <i className={`${node.data.toolIcon} ${classes.toolIcon}`} onClick={handleClick} />
      </div>
    );
  };

  return (
    <ContentPanel title="Broker Definitions" toolbar={<i className={`pi pi-plus ${classes.toolIcon}`} onClick={handleAddBrokerClick}></i>}>
      <div className={classes.container}>
        <Tree value={nodes} className={classes.tree} nodeTemplate={nodeTemplate} selectionMode="single" loading={isLoading}
          onExpand={handleExpand} onSelect={handleSelect}
          pt={{ container: { className: classes.treeContainer }, label: { className: classes.treeNodeLabel } }}
        />
        <BrokerConfigDialog config={brokerForConfig} brokerEditor={brokerEditor} onHide={handleConfigHide} />
        <ReplayTopicDialog config={brokerAndReplayTopic} brokerEditor={brokerEditor} onHide={handleTopicDialogHide} />
      </div>
    </ContentPanel>
  );
}