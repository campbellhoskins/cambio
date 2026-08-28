import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { HomeRoute } from "../routes/HomeRoute.js";
import { RoomRoute } from "../routes/RoomRoute.js";

const router = createBrowserRouter([
  { path: "/", element: <HomeRoute /> },
  { path: "/room/:code", element: <RoomRoute /> },
  { path: "/rules", element: <Placeholder title="Rules reference" /> },
  { path: "/tutorial", element: <Placeholder title="Tutorial" /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export function App(): React.ReactElement {
  return <RouterProvider router={router} />;
}

function Placeholder({ title }: { readonly title: string }): React.ReactElement {
  return (
    <main className="app-shell" id="main-content">
      <section className="hero panel">
        <p className="eyebrow">Coming soon</p>
        <h1>{title}</h1>
        <p>This route is reserved for a later phase.</p>
        <a className="text-link" href="/">Return home</a>
      </section>
    </main>
  );
}
