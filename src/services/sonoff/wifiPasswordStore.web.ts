/** Browsers cannot pair plugs, and have no secure store: nothing is remembered on web. */
export const wifiPasswordStore = {
  available: false,
  load: async (_ssid: string): Promise<string | null> => null,
  save: async (_ssid: string, _password: string): Promise<void> => undefined,
  forget: async (_ssid: string): Promise<void> => undefined,
};
