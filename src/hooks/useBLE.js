import { useState, useRef, useCallback, useEffect } from 'react';

const SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
const CMD_CHAR_UUID = '12345678-1234-1234-1234-123456789abd';
const STATUS_CHAR_UUID = '12345678-1234-1234-1234-123456789abe';

/**
 * BLE CENTRAL (client) — phone scans for and connects to the watch.
 *
 * Architecture (after firmware swap):
 *   Watch  = PERIPHERAL / GATT Server  (advertises SERVICE_UUID)
 *   Phone  = CENTRAL    / GATT Client  (scans via Web Bluetooth)
 *
 * Characteristics hosted on watch:
 *   CMD    (WRITE)  — phone writes data TO watch  (TRACK:, TIME:)
 *   STATUS (NOTIFY) — watch sends data TO phone   (PLAY_PAUSE, NOTE_ON, …)
 */
export default function useBLE({ onCommand }) {
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [scanning, setScanning] = useState(false);

  const deviceRef = useRef(null);
  const serverRef = useRef(null);
  const cmdCharRef = useRef(null);     // phone writes here  → watch receives
  const statusCharRef = useRef(null);  // phone subscribes   → watch notifies

  // ── Connect ─────────────────────────────────────────────────
  const connect = useCallback(async () => {
    try {
      setScanning(true);

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
      });

      device.addEventListener('gattserverdisconnected', () => {
        setConnected(false);
        setDeviceName('');
        deviceRef.current = null;
        serverRef.current = null;
        cmdCharRef.current = null;
        statusCharRef.current = null;
      });

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);

      // CMD characteristic — phone WRITES commands/data to watch
      const cmdChar = await service.getCharacteristic(CMD_CHAR_UUID);

      // STATUS characteristic — phone SUBSCRIBES to watch notifications
      const statusChar = await service.getCharacteristic(STATUS_CHAR_UUID);
      await statusChar.startNotifications();
      statusChar.addEventListener('characteristicvaluechanged', (event) => {
        const value = new TextDecoder().decode(event.target.value);
        onCommand?.(value);
      });

      deviceRef.current = device;
      serverRef.current = server;
      cmdCharRef.current = cmdChar;
      statusCharRef.current = statusChar;
      setDeviceName(device.name || 'Sling Watch');
      setConnected(true);
      setScanning(false);

      // Send initial time sync to watch
      const timestamp = Math.floor(Date.now() / 1000);
      const data = new TextEncoder().encode(`TIME:${timestamp}`);
      await cmdChar.writeValueWithResponse(data);
    } catch (err) {
      setScanning(false);
      console.error('BLE connection failed:', err);
    }
  }, [onCommand]);

  // ── Disconnect ──────────────────────────────────────────────
  const disconnect = useCallback(() => {
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect();
    }
  }, []);

  // ── Send data to watch (write to CMD characteristic) ────────
  const sendToWatch = useCallback(async (message) => {
    if (!cmdCharRef.current) return;
    try {
      const data = new TextEncoder().encode(message);
      await cmdCharRef.current.writeValueWithResponse(data);
    } catch (err) {
      console.error('BLE write failed:', err);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return { connected, deviceName, scanning, connect, disconnect, sendToWatch };
}
