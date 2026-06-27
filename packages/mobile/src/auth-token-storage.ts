import * as SecureStore from "expo-secure-store";

const AUTH_TOKEN_KEY = "aichat.authToken";

export async function loadAuthToken() {
  return SecureStore.getItemAsync(AUTH_TOKEN_KEY);
}

export async function saveAuthToken(token: string) {
  await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
}

export async function clearAuthToken() {
  await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
}
