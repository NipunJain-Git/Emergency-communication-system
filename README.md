 HEAD
# Emergency-communication-system

# Offline Emergency Communication — Android APK Project

This is a native Android wrapper around the supplied mobile UI, with native BLE support for the two ESP32 firmware files.

## Roles
- Sender -> scans for BLE device named `Emergency-Sender`
- Receiver -> scans for BLE device named `Emergency-Receiver`

Both roles can send messages. The physical message path is:

Phone -> Bluetooth LE -> ESP32 -> LoRa -> ESP32 -> Bluetooth LE -> Phone

## BLE UUIDs
Service:
6E400001-B5A3-F393-E0A9-E50E24DCCA9E

Phone -> ESP32 (WRITE):
6E400002-B5A3-F393-E0A9-E50E24DCCA9E

ESP32 -> Phone (NOTIFY):
6E400003-B5A3-F393-E0A9-E50E24DCCA9E

## Hardware indicator
The app header shows:
- ESP32 Disconnected
- Connecting…
- ESP32 Connected (green pulsing indicator)
- LoRa transmitting… (amber activity indicator)
- LoRa message received / ACK (blue activity indicator)
- Connection error (red)

## Build in Android Studio
Open this folder as a Gradle project and run:
Build > Build Bundle(s) / APK(s) > Build APK(s)

Debug APK:
app/build/outputs/apk/debug/app-debug.apk

## Build on GitHub
Push the project to a GitHub repository, open Actions, run `Build Android APK`, then download the `EmergencyCommunication-debug` artifact.

## Important
The app uses BLE, so test first on an Android phone with Bluetooth turned on.
Android will request Bluetooth permission on first launch.

The APK is a native app; the Vercel URL is NOT required for messaging once this app is installed.

The LoRa hardware/ESP32 firmware must be powered for physical communication.

