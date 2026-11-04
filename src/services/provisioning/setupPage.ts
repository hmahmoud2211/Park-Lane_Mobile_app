import * as WebBrowser from 'expo-web-browser';

/**
 * Opens a device's own setup page (WLED at 4.3.2.1, SONOFF DIY at
 * 10.10.7.1) for the guided setups, where the resident types the Wi-Fi
 * into the device's form. The phone must be on the device's network
 * system-wide for the browser to reach it (see wifiJoin.ts).
 */
export async function openDeviceSetupPage(deviceIp: string): Promise<void> {
  await WebBrowser.openBrowserAsync(`http://${deviceIp}/`);
}
