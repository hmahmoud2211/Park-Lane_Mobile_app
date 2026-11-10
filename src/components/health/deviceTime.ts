const pad = (value: number) => String(value).padStart(2, '0');

/** `HH:mm` of a date on the device's clock. */
export const deviceTimeOf = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** The next minute on the device's clock. */
export const deviceTime = () => deviceTimeOf(new Date(Date.now() + 60_000));
