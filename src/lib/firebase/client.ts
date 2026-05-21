"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";

import { firebaseConfig, useEmulators } from "./config";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const clientAuth = getAuth(app);
export const clientDb = getFirestore(app);
export const clientStorage = getStorage(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

if (useEmulators && typeof window !== "undefined") {
  const emulatorHost = window.location.hostname;
  const flag = "__firebase_emulators_connected__";
  const w = window as unknown as Record<string, boolean | undefined>;
  if (!w[flag]) {
    connectAuthEmulator(clientAuth, `http://${emulatorHost}:9099`, {
      disableWarnings: true,
    });
    connectFirestoreEmulator(clientDb, emulatorHost, 8080);
    connectStorageEmulator(clientStorage, emulatorHost, 9199);
    w[flag] = true;
  }
}

export { app };
