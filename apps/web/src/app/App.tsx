import { Suspense, lazy } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { HomeRoute } from "../routes/HomeRoute.js";
import { RoomRoute } from "../routes/RoomRoute.js";

const RulesRoute = lazy(() =>
  import("@cambio/tutorial/rules").then((module) => ({ default: module.RulesRoute })),
);
const TutorialRoute = lazy(() =>
  import("@cambio/tutorial").then((module) => ({ default: module.TutorialRoute })),
);

const router = createBrowserRouter([
  { path: "/", element: <HomeRoute /> },
  { path: "/room/:code", element: <RoomRoute /> },
  { path: "/rules", element: <LazyRoute><RulesRoute /></LazyRoute> },
  { path: "/tutorial", element: <LazyRoute><TutorialRoute /></LazyRoute> },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export function App(): React.ReactElement {
  return <RouterProvider router={router} />;
}

function LazyRoute({ children }: { readonly children: React.ReactElement }): React.ReactElement {
  return <Suspense fallback={<main className="app-shell" id="main-content"><p>Loading…</p></main>}>{children}</Suspense>;
}
