import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyDabz96liH7dJTVwzQ-cxH502GCzRKJ1FE",
  authDomain: "sunsimulation-4d7c5.firebaseapp.com",
  // NOTE: Make sure this URL matches the one from your Realtime DB screenshot
  databaseURL: "https://sunsimulation-4d7c5-default-rtdb.firebaseio.com", 
  projectId: "sunsimulation-4d7c5",
  storageBucket: "sunsimulation-4d7c5.firebasestorage.app",
  messagingSenderId: "590125833621",
  appId: "G-YZMP72MMMN"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Realtime Database and export it
export const db = getDatabase(app);