import { SERVICE_FITNESS_MACHINE, CHAR_INDOOR_BIKE_DATA } from './constants.js';
import { parseIndoorBikeData } from './ftms-parser.js';

// Handles the Web Bluetooth lifecycle for the trainer's FTMS Indoor Bike
// Data notifications. No knowledge of rolling averages, distance, or the
// DOM — pure transport + parse plumbing. Consumers subscribe to 'reading',
// 'connected', and 'disconnected' events.
export class TrainerConnection extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.characteristic = null;
    this._onCharacteristicValueChanged = this._onCharacteristicValueChanged.bind(this);
    this._onGattDisconnected = this._onGattDisconnected.bind(this);
  }

  // Must be called directly from a user gesture's click handler chain —
  // navigator.bluetooth.requestDevice requires transient activation.
  async connect() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_FITNESS_MACHINE] }],
    });
    this.device.addEventListener('gattserverdisconnected', this._onGattDisconnected);

    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_FITNESS_MACHINE);
    this.characteristic = await service.getCharacteristic(CHAR_INDOOR_BIKE_DATA);

    this.characteristic.addEventListener('characteristicvaluechanged', this._onCharacteristicValueChanged);
    await this.characteristic.startNotifications();

    this.dispatchEvent(new CustomEvent('connected', { detail: { deviceName: this.device.name } }));
  }

  disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
  }

  _onCharacteristicValueChanged(event) {
    const reading = parseIndoorBikeData(event.target.value);
    this.dispatchEvent(new CustomEvent('reading', { detail: { reading, receivedAt: performance.now() } }));
  }

  _onGattDisconnected() {
    this.dispatchEvent(new CustomEvent('disconnected'));
  }
}
