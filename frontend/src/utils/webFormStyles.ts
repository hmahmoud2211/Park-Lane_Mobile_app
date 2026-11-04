import { Platform } from 'react-native';

const STYLE_ID = 'parklane-form-reset';

/**
 * On web, react-native-web renders TextInput as a real <input>, which the
 * browser paints with its own background, focus ring and autofill highlight.
 * None of those are reachable from React Native styles, so they are cleared
 * with a stylesheet injected once.
 *
 * The long background-color transition is the standard way to defeat Chrome's
 * autofill fill, which cannot be overridden directly.
 */
export function installWebFormStyles(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return;
  }

  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    'input, textarea {',
    '  background-color: transparent !important;',
    '  border: 0 !important;',
    '  outline: none !important;',
    '  box-shadow: none !important;',
    '}',
    'input:-webkit-autofill,',
    'input:-webkit-autofill:hover,',
    'input:-webkit-autofill:focus,',
    'input:-webkit-autofill:active {',
    '  -webkit-text-fill-color: #FFFFFF !important;',
    '  caret-color: #FFFFFF !important;',
    '  transition: background-color 9999s ease-in-out 0s !important;',
    '}',
  ].join('\n');

  document.head.appendChild(style);
}
