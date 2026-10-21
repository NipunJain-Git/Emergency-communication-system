package com.emergencycommunication.app;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.graphics.Color;
import android.view.Window;

import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.UUID;

public class MainActivity extends Activity {

    private static final String SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
    private static final String RX_UUID      = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";
    private static final String TX_UUID      = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";

    private static final int REQ_BT = 501;

    private WebView webView;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner scanner;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writeCharacteristic;
    private BluetoothGattCharacteristic notifyCharacteristic;
    private String requestedRole = "sender";
    private boolean scanning = false;

    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(Color.rgb(6, 23, 47));
        w.setNavigationBarColor(Color.rgb(6, 23, 47));

        BluetoothManager manager = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
        bluetoothAdapter = manager.getAdapter();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(6, 23, 47));
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setAllowContentAccess(true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new AndroidBleBridge(), "AndroidBLE");
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");

        requestBluetoothPermissions();
    }

    private void requestBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissions(new String[]{
                    Manifest.permission.BLUETOOTH_SCAN,
                    Manifest.permission.BLUETOOTH_CONNECT
            }, REQ_BT);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION
            }, REQ_BT);
        }
    }

    private boolean hasBlePermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
                    && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private void jsState(final String state, final String detail) {
        final String safeState = quote(state);
        final String safeDetail = quote(detail == null ? "" : detail);
        runOnUiThread(() -> webView.evaluateJavascript(
                "window.onEsp32State && window.onEsp32State(" + safeState + "," + safeDetail + ");",
                null
        ));
    }

    private void jsMessage(final String message) {
        final String safe = quote(message);
        runOnUiThread(() -> webView.evaluateJavascript(
                "window.onEsp32Message && window.onEsp32Message(" + safe + ");",
                null
        ));
    }

    private String quote(String s) {
        String v = s == null ? "" : s;
        return "\"" + v.replace("\\","\\\\").replace("\"","\\\"")
                .replace("\n","\\n").replace("\r","\\r") + "\"";
    }

    private void startScan() {
        if (!hasBlePermissions()) {
            jsState("error", "Bluetooth permission required");
            requestBluetoothPermissions();
            return;
        }
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            jsState("error", "Turn on Bluetooth");
            return;
        }

        scanner = bluetoothAdapter.getBluetoothLeScanner();
        if (scanner == null) {
            jsState("error", "BLE scanner unavailable");
            return;
        }

        final String targetName = requestedRole.equals("sender")
                ? "Emergency-Sender"
                : "Emergency-Receiver";

        jsState("connecting", "Scanning for " + targetName);
        scanning = true;

        ScanFilter filter = new ScanFilter.Builder().setDeviceName(targetName).build();
        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();

        scanner.startScan(Collections.singletonList(filter), settings, scanCallback);

        handler.postDelayed(() -> {
            if (scanning) {
                stopScan();
                jsState("error", targetName + " not found");
            }
        }, 12000);
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothDevice device = result.getDevice();
            String expected = requestedRole.equals("sender")
                    ? "Emergency-Sender"
                    : "Emergency-Receiver";
            String name = null;
            try {
                name = device.getName();
            } catch (SecurityException ignored) {}

            if (name == null || !expected.equals(name)) return;

            stopScan();
            connectGatt(device);
        }

        @Override
        public void onScanFailed(int errorCode) {
            scanning = false;
            jsState("error", "BLE scan failed (" + errorCode + ")");
        }
    };

    private void stopScan() {
        if (scanner != null && scanning) {
            try { scanner.stopScan(scanCallback); } catch (SecurityException ignored) {}
        }
        scanning = false;
    }

    private void connectGatt(BluetoothDevice device) {
        if (!hasBlePermissions()) {
            jsState("error", "Bluetooth permission required");
            return;
        }

        jsState("connecting", "Connecting to ESP32…");
        try {
            gatt = device.connectGatt(this, false, gattCallback);
        } catch (SecurityException e) {
            jsState("error", "Bluetooth connection permission denied");
        }
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (newState == android.bluetooth.BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                gatt = g;
                handler.postDelayed(() -> {
                    try { g.discoverServices(); } catch (SecurityException e) { jsState("error", "Bluetooth permission denied"); }
                }, 250);
            } else if (newState == android.bluetooth.BluetoothProfile.STATE_DISCONNECTED) {
                writeCharacteristic = null;
                notifyCharacteristic = null;
                jsState("disconnected", "ESP32 Disconnected");
                try { g.close(); } catch (Exception ignored) {}
                gatt = null;
            } else if (status != BluetoothGatt.GATT_SUCCESS) {
                jsState("error", "GATT connection failed (" + status + ")");
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                jsState("error", "Could not discover ESP32 service");
                return;
            }

            BluetoothGattService service = g.getService(UUID.fromString(SERVICE_UUID));
            if (service == null) {
                jsState("error", "Emergency service not found");
                return;
            }

            writeCharacteristic = service.getCharacteristic(UUID.fromString(RX_UUID));
            notifyCharacteristic = service.getCharacteristic(UUID.fromString(TX_UUID));

            if (writeCharacteristic == null || notifyCharacteristic == null) {
                jsState("error", "ESP32 BLE characteristics not found");
                return;
            }

            try {
                g.setCharacteristicNotification(notifyCharacteristic, true);
                BluetoothGattDescriptor descriptor = notifyCharacteristic.getDescriptor(
                        UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"));
                if (descriptor != null) {
                    descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                    g.writeDescriptor(descriptor);
                }
            } catch (SecurityException e) {
                jsState("error", "Bluetooth permission denied");
                return;
            }

            jsState("connected", "ESP32 Connected");
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic characteristic) {
            if (UUID.fromString(TX_UUID).equals(characteristic.getUuid())) {
                byte[] data = characteristic.getValue();
                String value = new String(data, StandardCharsets.UTF_8);
                if (value.startsWith("STATUS|TX_OK|")) jsState("tx", "LoRa transmitting…");
                else if (value.startsWith("MSG|RECEIVED|") || value.startsWith("ACK|")) jsState("rx", "LoRa activity");
                jsMessage(value);
            }
        }

        // For newer Android callback signature.
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic characteristic, byte[] value) {
            if (UUID.fromString(TX_UUID).equals(characteristic.getUuid()) && value != null) {
                String msg = new String(value, StandardCharsets.UTF_8);
                if (msg.startsWith("STATUS|TX_OK|")) jsState("tx", "LoRa transmitting…");
                else if (msg.startsWith("MSG|RECEIVED|") || msg.startsWith("ACK|")) jsState("rx", "LoRa activity");
                jsMessage(msg);
            }
        }
    };

    private void sendToEsp32(String text, String id) {
        if (writeCharacteristic == null || gatt == null) {
            jsState("error", "ESP32 is not connected");
            return;
        }

        String payload = "MSG|" + id + "|" + text;
        byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);

        if (bytes.length > 180) {
            jsState("error", "Message is too long");
            return;
        }

        writeCharacteristic.setValue(bytes);
        writeCharacteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);

        try {
            boolean started = gatt.writeCharacteristic(writeCharacteristic);
            if (!started) jsState("error", "Bluetooth write could not start");
        } catch (SecurityException e) {
            jsState("error", "Bluetooth permission denied");
        }
    }

    private void closeGatt() {
        stopScan();
        if (gatt != null) {
            try { gatt.disconnect(); } catch (SecurityException ignored) {}
            try { gatt.close(); } catch (Exception ignored) {}
        }
        gatt = null;
        writeCharacteristic = null;
        notifyCharacteristic = null;
        jsState("disconnected", "ESP32 Disconnected");
    }

    @Override
    protected void onDestroy() {
        closeGatt();
        super.onDestroy();
    }

    public class AndroidBleBridge {
        @JavascriptInterface
        public void connect(String role) {
            requestedRole = "receiver".equalsIgnoreCase(role) ? "receiver" : "sender";
            handler.post(() -> {
                closeGatt();
                startScan();
            });
        }

        @JavascriptInterface
        public void sendMessage(String text, String id) {
            handler.post(() -> sendToEsp32(text, id));
        }

        @JavascriptInterface
        public void disconnect() {
            handler.post(MainActivity.this::closeGatt);
        }
    }
}
