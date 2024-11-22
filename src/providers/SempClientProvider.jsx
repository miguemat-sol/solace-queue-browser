import { createContext, useContext } from "react";
import { AllApi } from "../utils/solace/semp/monitor";

const SolaceSempContext = createContext();

export function SempClientProvider({ value, children }) {
  return (
    <SolaceSempContext.Provider value={value}>
      {children}
    </SolaceSempContext.Provider>
  );
}

export function useSempApi(ApiCtor = AllApi) {
  const ApiClient = useContext(SolaceSempContext);
  return {
    getClient: (opts) => {
      const client = new ApiClient();
      const { useTls, hostName, sempPort, sempUsername, sempPassword } = opts;
      Object.assign(client, { 
        basePath: `${(useTls ? 'https': 'http')}://${hostName}:${sempPort}/SEMP/v2/monitor`
      });
      Object.assign(client.authentications.basicAuth, { username: sempUsername, password: sempPassword });
      return new ApiCtor(client);
    }
  }
}