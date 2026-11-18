import { registerRootComponent } from 'expo';

// First: Family Circle's background location task must be defined before anything renders, or a phone that wakes
// the app in the background to deliver positions finds no task to give them to.
import './src/features/circles/services/backgroundTask';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
