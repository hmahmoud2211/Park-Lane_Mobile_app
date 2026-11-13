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
  ownerOnly: 'Only the person who set up your home hub can add devices. Ask them to add it.',
  cloudTitle: 'Devices linked through the building',
  cloudBody: 'If your device only works with its maker’s cloud account, you can link that account through the building’s system instead.',
  cloudAction: 'Link a manufacturer account',
} as const;
