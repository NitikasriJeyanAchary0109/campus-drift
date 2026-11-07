import React from 'react';
import { Link } from 'react-router-dom';
import { PixelEmptyState } from '../components/ui/pixel/PixelEmptyState';

/** The address does not exist. */
export const NotFound: React.FC = () => (
  <PixelEmptyState
    kind="error"
    title="Page not found"
    description="There is nothing at this address. It may have moved, or the link may be wrong."
    action={<Link to="/" className="pxl-btn pxl-btn-md pxl-btn-primary pxl-focus">Go to Home</Link>}
  />
);

/** The page exists but this role may not use it. The server enforces the same rule on every request. */
export const Forbidden: React.FC = () => (
  <PixelEmptyState
    kind="error"
    title="You do not have access to this page"
    description="Your role does not include it. Ask an administrator if you need it."
    action={<Link to="/" className="pxl-btn pxl-btn-md pxl-btn-primary pxl-focus">Go to Home</Link>}
  />
);
