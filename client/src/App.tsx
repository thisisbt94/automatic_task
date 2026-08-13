import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Kiosk from "./pages/Kiosk";
import ResultShare from "./pages/ResultShare";
import Insights from "./pages/Insights";
import Admin from "./pages/Admin";
import { getPublicConfig } from "./lib/api";

export default function App() {
  const [kioskInactivitySeconds, setKioskInactivitySeconds] = useState(60);

  useEffect(() => {
    getPublicConfig()
      .then((c) => setKioskInactivitySeconds(c.kioskInactivitySeconds))
      .catch(() => {});
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Kiosk kioskInactivitySeconds={kioskInactivitySeconds} />} />
      <Route path="/result/:resultId" element={<ResultShare />} />
      <Route path="/insights" element={<Insights />} />
      <Route path="/admin" element={<Admin />} />
    </Routes>
  );
}
