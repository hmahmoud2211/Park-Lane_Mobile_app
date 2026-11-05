/** Copy for Add Device: choosing the manufacturer, the first step of connecting any device. */
export const addDeviceCopy = {
  title: 'Add Device',
  subtitle: 'Choose who made your device.',
  brandsTitle: 'Manufacturer',
  brandsIntro: 'CUBE connects to your devices without the maker’s app or account wherever it can. Other brands link through your account with the maker.',
  search: 'Search brands',
  noMatch: 'No brand matches. Choose Other / Unknown brand to see what the gateway finds.',
  loadFailed: 'The brands could not be loaded.',
  retry: 'Try again',
  noGatewayTitle: 'Connect your CUBE Gateway first',
  noGatewayBody:
    'Devices are found and controlled by the CUBE Gateway running on a computer in your home. Connect this phone to it once, then add devices here.',
  connectGateway: 'Connect gateway',
  offlineTitle: 'Your gateway is not reachable',
  unauthorizedTitle: 'Your gateway no longer accepts this phone',
  reconnect: 'Try again',
  manageGateway: 'Gateway settings',
  cloudTitle: 'Devices linked through the building',
  cloudBody: 'If your device only works with its maker’s cloud account, you can link that account through the building’s smart home hub instead.',
  cloudAction: 'Link a manufacturer account',
} as const;
