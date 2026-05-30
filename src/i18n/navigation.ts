import { createNavigation } from "next-intl/navigation";

import { routing } from "@/i18n/routing";

const navigation = createNavigation(routing);

export const { Link, getPathname, usePathname, useRouter } = navigation;

export default navigation.Link;
