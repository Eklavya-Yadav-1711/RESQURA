import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buildMapHtml } from './mapHtml';
import { IconButton } from './ui';
import { Colors, Radius, Space, Type } from '../theme';

/**
 * Real OpenStreetMap view of an emergency — victim, responders and the live
 * line between them. No API key: the tiles are OSM/CARTO raster tiles drawn
 * by Leaflet inside a WebView, which also keeps it working in Expo Go.
 *
 * The inline map is deliberately gesture-free so it never fights the page
 * scroll; tapping the corner button opens a full-screen interactive copy.
 */
function MapSurface({ victim, me, responders, showRoute, interactive, onExpand, style }) {
  const webRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const html = useMemo(() => buildMapHtml({ interactive }), [interactive]);

  // The identity of `source` must stay stable. A fresh object each render made
  // the WebView reload the whole map — once a second on screens with a ticking
  // timer, which reads as the screen refreshing constantly.
  const source = useMemo(
    () => (Platform.OS === 'android' ? { html, baseUrl: 'https://localhost/' } : { html }),
    [html]
  );

  const state = useMemo(() => ({
    victim: point(victim),
    me: point(me),
    responders: (responders || []).map((r, i) => point(r, r.id ?? i)).filter(Boolean),
    showRoute: Boolean(showRoute),
  }), [victim, me, responders, showRoute]);

  const payload = JSON.stringify(state);
  const lastPayload = useRef(null);

  const push = useCallback((force) => {
    if (!force && lastPayload.current === payload) return;
    lastPayload.current = payload;
    webRef.current?.injectJavaScript(
      `window.RESQORA && window.RESQORA.update(${payload}); true;`
    );
  }, [payload]);

  // Only when something actually moved — the page keeps its own markers, so
  // this never re-renders the map itself.
  useEffect(() => { push(); }, [push]);

  function onMessage(event) {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'ready') push(true);
      else if (data.type === 'error') setFailed(true);
      else if (data.type === 'expand') onExpand?.();
    } catch {}
  }

  if (failed) {
    return (
      <View style={[styles.fallback, style]}>
        <Text style={styles.fallbackTitle}>Map unavailable offline</Text>
        {victim && (
          <Text style={styles.fallbackCoords}>
            {victim.lat?.toFixed(5)}, {victim.lon?.toFixed(5)}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.surface, style]}>
      <WebView
        ref={webRef}
        // Android needs a real origin before it will fetch the Leaflet script
        // and the tile images referenced from an inline HTML document.
        source={source}
        originWhitelist={['*']}
        onMessage={onMessage}
        onError={() => setFailed(true)}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        scrollEnabled={false}
        nestedScrollEnabled={interactive}
        androidLayerType="hardware"
        allowsInlineMediaPlayback
        setSupportMultipleWindows={false}
        style={styles.web}
        containerStyle={styles.web}
      />
    </View>
  );
}

function point(value, id) {
  if (!value) return null;
  const lat = Number(value.lat);
  const lon = Number(value.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    label: value.label || value.name || undefined,
    ...(id === undefined ? {} : { id: String(id) }),
  };
}

export default function LiveMap({ height = 210, ...props }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <MapSurface {...props} style={{ height }} onExpand={() => setExpanded(true)} />

      <Modal visible={expanded} animationType="slide" onRequestClose={() => setExpanded(false)}>
        <SafeAreaView style={styles.modal} edges={['top', 'bottom']}>
          <View style={styles.modalBar}>
            <Text style={styles.modalTitle}>Live map</Text>
            <IconButton icon="close" label="Close map" onPress={() => setExpanded(false)} />
          </View>
          <MapSurface {...props} interactive style={styles.modalMap} />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.map,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  web: { flex: 1, backgroundColor: Colors.map },
  fallback: {
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  fallbackTitle: { ...Type.bodyStrong, color: Colors.muted },
  fallbackCoords: { ...Type.caption, color: Colors.subtle, marginTop: Space.sm },
  modal: { flex: 1, backgroundColor: Colors.bg },
  modalBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Space.xl, paddingVertical: Space.md,
  },
  modalTitle: { ...Type.heading, color: Colors.text },
  modalMap: { flex: 1, margin: Space.lg, marginTop: 0 },
});
