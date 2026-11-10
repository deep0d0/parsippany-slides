import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "./editor";
import { Play } from "./play";
import { Remote } from "./remote";
import "./styles.css";

const path = window.location.pathname;

function App() {
  if (path === "/play" || path.startsWith("/play/")) return <Play />;
  if (path === "/remote" || path.startsWith("/remote/")) return <Remote />;
  return <Editor />;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
