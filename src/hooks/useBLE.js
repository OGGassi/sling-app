import { useState, useRef, useCallback, useEffect } from 'react';

const SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
const CMD_CHAR_UUID = '12345678-1234-1234-1234-123456789abd';
const STATUS_CHAR_UUID = '12345678-1234-1234-1234-123456789abe';

// Binary note packet command bytes
const BIN_NOTE_ON  = 0x01;
const BIN_NOTE_OFF = 0x02;

/**
 * BLE CENTRAL (client) — phone scans for and connects to the watch.
 *
 * Architecture:
 *   Watch  = PERIPHERAL / GATT Server  (advertises SERVICE_UUID)
 *   Phone  = CENTRAL    / GATT Client  (scans via Web Bluetooth)
 *
 * Characteristics hosted on watch:
 *   CMD    (WRITE)  — phone writes data TO watch  (TRACK:, TIME:)
 *   STATUS (NOTIFY) — watch sends data TO phone   (PLAY_PAUSE, NOTE_ON, binary packets)
 *
 * Binary 6-byte note packet format:
 *   [cmd(1), note(1), velocity(1), pitchBend(1 signed), vibrato(1), tremolo(1)]
 */
export default function useBLE({ onCommand }) {
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [scanning, setScanning] = useState(false);

  const deviceRef = useRef(null);
  const serverRef = useRef(null);
  const cmdCharRef = useRef(null);
  const statusCharRef = useRef(null);

  // ── Handle incoming BLE notification ────────────────────────
  const handleNotification = useCallback(
    (event) => {
      const buf = event.target.value;
      const bytes = new Uint8Array(buf.buffer);

      // ── Binary 6-byte note packet ──
      if (bytes.length === 6 && (bytes[0] === BIN_NOTE_ON || bytes[0] === BIN_NOTE_OFF)) {
        const cmd       = bytes[0];
        const note      = bytes[1];
        const velocity  = bytes[2];
        // pitchBend is signed int8: reinterpret unsigned → signed
        const pitchBend = new Int8Array([bytes[3]])[0];
        const vibrato   = bytes[4];
        const tremolo   = bytes[5];

        if (cmd === BIN_NOTE_ON) {
          onCommand?.(`NOTE_ON:${note}:${velocity}:${pitchBend}:${vibrato}:${tremolo}`);
        } else {
          onCommand?.(`NOTE_OFF:${note}`);
        }
        return;
      }

      // ── String command (everything else) ──
      const str = new TextDecoder().decode(buf);
      onCommand?.(str);
    },
    [onCommand]
  );

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
      statusChar.addEventListener('characteristicvaluechanged', handleNotification);

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
  }, [handleNotification]);

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
