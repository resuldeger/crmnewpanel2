import { createBrowserRouter, Navigate } from "react-router-dom";
import StudioPicker from "./screens/StudioPicker";
import BookingWizard from "./screens/BookingWizard";
import ManageBooking from "./screens/ManageBooking";
import NotFound from "./screens/NotFound";

/* Every meaningful state now has an address:
 *   /                       studio picker
 *   /:slug/book             wizard, welcome step
 *   /:slug/book/:step       wizard, any step (back/forward/refresh all work)
 *   /:slug/book/done/:uuid  confirmation (linkable, survives a refresh)
 *   /b/:uuid                manage · reschedule · cancel
 */
export const router = createBrowserRouter([
  { path: "/", element: <StudioPicker /> },
  { path: "/:slug/book", element: <BookingWizard /> },
  { path: "/:slug/book/done/:uuid", element: <BookingWizard /> },
  { path: "/:slug/book/:step", element: <BookingWizard /> },
  { path: "/b/:uuid", element: <ManageBooking /> },
  // legacy shape kept alive so old links and QR codes keep working
  { path: "/booking/:slug", element: <Navigate to="/:slug/book" replace /> },
  { path: "*", element: <NotFound /> },
]);
