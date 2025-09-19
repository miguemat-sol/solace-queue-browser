import { createContext, useContext, useEffect, useState } from "react";
import { BaseDirectory } from "@tauri-apps/plugin-fs";
import { fs } from '../utils/tauri/api';

import { useSempApi } from "./SempClientProvider";
import solace from '../utils/solace/solclientasync';

const BrokerConfigContext = createContext();
const baseDir = BaseDirectory.AppConfig;

export const ConfigSource = {
  FS: {
    name: 'fs',
    readConfig: async () => {
      fs.mkdir('', { baseDir, recursive: true });
      if (await fs.exists('config.json', { baseDir })) {
        const configData = await fs.readTextFile('config.json', { baseDir });
        return JSON.parse(configData);
      } else {
        console.log('no config found');
        return [];
      }
    },
    writeConfig: async (brokers) => {
      await fs.writeTextFile('config.json', JSON.stringify(brokers), { baseDir });
    }
  },
  LOCAL_STORAGE: {
    name: 'localStorage',
    readConfig: async () => {
      const configData = window.localStorage.getItem('config');
      return configData ? JSON.parse(configData) : [];
    },
    writeConfig: async (brokers) => {
      window.localStorage.setItem('config', JSON.stringify(brokers));
    }
  }
}

export function BrokerConfigProvider({ source, children }) {
  const [brokers, setBrokers] = useState([]);
  return (
    <BrokerConfigContext.Provider value={{ source, brokers, setBrokers }}>
      {children}
    </BrokerConfigContext.Provider>
  )
}

export function useBrokerConfig() {
  const { source, brokers, setBrokers } = useContext(BrokerConfigContext);
  const sempApi = useSempApi();

  useEffect(() => {
    source.readConfig().then(brokers => setBrokers(brokers));
  }, []);

  const saveBroker = (config) => {
    const match = brokers.find(b => b.id === config.id);
    if (match === undefined) {
      config.id = Date.now();
      brokers.push(config);
    } else {
      Object.assign(match, config);
    }
    source.writeConfig(brokers);
    setBrokers([...brokers]);
  };

  const deleteBroker = (config) => {
    const filteredBrokers = brokers.filter(b => b.id !== config.id);
    source.writeConfig(filteredBrokers);
    setBrokers(filteredBrokers);
  };

  const testBroker = async (config) => {
    // TODO: consider a solace.with(config)
    const { vpn, useTls, hostName, clientPort, clientUsername, clientPassword } = config;

    try {
      const session = solace.SolclientFactory.createAsyncSession({
        url: `/api/${(useTls ? 'wss' : 'ws')}/${hostName}:${clientPort}`,
        vpnName: vpn,
        userName: clientUsername,
        password: clientPassword,
        reconnectRetries: 0,
        connectRetries: 0
      });
      await session.connect();
      session.disconnect();
    } catch (err) {
      console.error("SMF Connection Error:", err);

      if(err.responseCode) switch(err.responseCode) {
        case 401:
          return { result: { connected: false, replay: false}, message: { severity:'error', summary: 'SMF: Unauthorized', detail: 'Incorrect client username or password.' }};
      }
      
      const errMsg = err.message;

      if (errMsg.includes('invalid URL')) {
        return { result: { connected: false, replay: false}, message: { severity:'error', summary: 'SMF: Failure', detail: 'Invalid broker URL.'}};
      }
      if (errMsg.includes('Connection error')) {
        return { result: { connected: false, replay: false}, message: { severity:'error', summary: 'SMF: Failure', detail: 'General connection error.'}};
      }

      return { result: { connected: false, replay: false}, message: { severity:'error', summary: 'SMF: Connection Error', detail: 'Unknown error!' }};    
    }

    const sempClient = sempApi.getClient(config);

    const handleResponse = ({status, body}) => {
      const errorDetail = (
        body?.meta?.error?.description ||
        (() => {
          const html = document.createElement('html');
          html.innerHTML = body;
          return html.querySelectorAll('center')?.[1]?.innerText;
        })() ||
        'Unexpected error'
      ) + '.';
      switch (status) {
        case 200:
          if (body.data.length > 0) {
            return { result: { connected: true, replay: true}, message: { severity:'info', summary: 'Success', detail: 'Broker connection succeeded.' }};
          } else {
            return { result: { connected: true, replay: false}, message: { severity:'warn', summary: 'Warning', detail: 'Replay Log not enabled on broker.' }};
          }
        case 400:
          return { result: { connected: false, replay: false}, message: { severity:'error', summary: 'SEMP: Bad Request', detail: errorDetail }};
        case 401:
          return { result: { connected: false, replay: false}, message: { severity:'error', summary: 'SEMP: Unauthorized', detail: errorDetail }};
        case 403:
          return { result: { connected: false, replay: false}, message: { severity:'error', summary: 'SEMP: Forbidden', detail: errorDetail }};
        default:
          return { result: { connected: false, replay: false}, message: { severity:'error', summary: `SEMP: HTTP ${status}`, detail: errorDetail }};
      }
    };

    try {
      const { response } = await sempClient.getMsgVpnReplayLogsWithHttpInfo(vpn, { select: ['replayLogName'] });
      return handleResponse(response);
    } catch (err) {
      console.error("SEMP API Error:", err);
      if(err.status && err.response) {
        const handledResponse = handleResponse(err.response);
        if (handledResponse) return handledResponse;
        return { result: { connected: false, replay: false}, message: { severity:'error', summary: `SEMP: HTTP ${err.status || 'Unknown Status'}`, detail: err.response?.body?.meta?.error?.description || err.message || 'Unknown error from SEMP API.' }};
      } else {
        const errMsg = err.toString();
        
        if (
          errMsg.includes('Invalid URL') ||
          errMsg.includes('expected empty host')
        ) {
          return { result: { connected: false, replay: false}, message: { severity:'error', summary: 'SEMP: Failure', detail: 'Invalid broker URL.' }};
        }
        
        if (
          errMsg.includes('Network Error') ||
          errMsg.includes('Request has been terminated')
        ) {
          return { result: { connected: false, replay: false}, message: { severity:'error', summary: 'SEMP: Failure', detail: 'Broker service unreachable.' }}
        }
      }
      return { result: { connected: false, replay: false}, message: { severity:'error', summary: 'SEMP: Failure', detail: 'Unknown error!' }};
    }
  };

  return {
    brokers,
    brokerEditor: {
      save: saveBroker,
      delete: deleteBroker,
      test: testBroker
    }
  };
}