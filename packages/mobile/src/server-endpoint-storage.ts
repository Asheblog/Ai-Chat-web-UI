import * as SecureStore from "expo-secure-store";

const SERVER_ENDPOINT_KEY = "aichat.serverEndpoint";

export async function loadServerEndpoint() {
  return SecureStore.getItemAsync(SERVER_ENDPOINT_KEY);
}

export async function saveServerEndpoint(endpoint: string) {
  await SecureStore.setItemAsync(SERVER_ENDPOINT_KEY, endpoint);
}
