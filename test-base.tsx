import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import { Button } from "./components/ui/button"

export function Test() {
  return (
    <Menu.Root>
      <Menu.Trigger render={<Button>Hi</Button>} />
    </Menu.Root>
  );
}
