// expo-router generates a `/_sitemap` page listing every route, in production exports too. A public site has no use for it:
// it is an unknown address like any other (W2.2, #129).
import { NotFound } from '@/screens/NotFound';
export default NotFound;
