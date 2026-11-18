import { AppleMaps, GoogleMaps } from 'expo-maps';
import { useMemo } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

import { useGlidingMembers } from '../hooks/useGlidingMembers';
import { cameraFor, lastSeenLabel } from '../services/circleRules';
import type { CircleMember } from '../types';

export interface CircleMapProps {
  /** Members with a position; others are left off. */
  members: readonly CircleMember[];
  style?: StyleProp<ViewStyle>;
}

/**
 * A Circle's members as pins on the phone's own map: Apple Maps on iPhone (no key needed), Google Maps on Android
 * (the key comes from app.config.js). The camera opens on everyone; pins slide as positions arrive. The web app has
 * no map (CircleMap.web.tsx) and shows the list alone.
 */
export function CircleMap({ members, style }: CircleMapProps) {
  const located = useMemo(() => members.filter((member) => member.location !== null), [members]);
  // Where the map opens: worked out once from who was there when it appeared, so pins moving later don't yank it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const camera = useMemo(() => cameraFor(located), [located.length]);
  const cameraPosition = camera ? { coordinates: { latitude: camera.latitude, longitude: camera.longitude }, zoom: camera.zoom } : undefined;
  // Pins slide to each new position instead of jumping (live view sends one every few seconds).
  const shown = useGlidingMembers(located);

  const markers = shown.map((member) => ({
    id: member.userId,
    coordinates: { latitude: member.location!.lat, longitude: member.location!.lng },
    title: member.you ? `${member.name} (you)` : member.name,
    snippet: lastSeenLabel(member.location!.at),
  }));

  if (Platform.OS === 'ios') {
    return <AppleMaps.View style={style} cameraPosition={cameraPosition} markers={markers.map(({ snippet: _snippet, ...marker }) => marker)} />;
  }
  return <GoogleMaps.View style={style} cameraPosition={cameraPosition} markers={markers} />;
}
