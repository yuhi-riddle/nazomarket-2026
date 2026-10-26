import "./styles.css";
import { app } from "./ui/app.ts";

const root = document.querySelector<HTMLElement>("#app");
if (root) app(root);
