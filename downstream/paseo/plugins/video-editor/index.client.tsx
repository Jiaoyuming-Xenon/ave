import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { EditDesk } from "./client/edit-desk.js";

function DeskItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: "desk" }), [openScreen]);
  return <SidebarRow icon="Scissors" active={currentScreen?.screenId === "desk"} onPress={open} />;
}

export default function contribute(client: PluginClientContext): () => void {
  const removeScreen = client.addScreen({ id: "desk", title: "剪辑工作台", Component: EditDesk });
  const removeItem = client.addSidebarHeaderItem({ id: "edit-desk", title: "剪辑工作台", Component: DeskItem });
  return () => {
    removeItem();
    removeScreen();
  };
}
