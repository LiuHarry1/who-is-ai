import React from 'react';
import ReactDOM from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import Landing from './pages/Landing';
import Room from './pages/Room';
import Host from './pages/Host';

const router = createHashRouter([
  { path: '/', element: <Landing /> },
  { path: '/room/:roomId', element: <Room /> },
  { path: '/host', element: <Host /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
