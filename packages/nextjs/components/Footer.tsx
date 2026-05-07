"use client";

import React from "react";
import { Address } from "@scaffold-ui/components";
import { SwitchTheme } from "~~/components/SwitchTheme";

const CONTRACT_ADDRESS = "0x92eb64088e5A291f5f8E837Aa203F01733f479c3";

export const Footer = () => {
  return (
    <div className="min-h-0 py-5 px-1 mb-11 lg:mb-0">
      <div className="fixed flex justify-between items-center w-full z-10 p-4 bottom-0 left-0 pointer-events-none">
        <div className="pointer-events-auto" />
        <SwitchTheme className="pointer-events-auto" />
      </div>
      <div className="w-full">
        <div className="flex flex-wrap justify-center items-center gap-2 text-sm w-full">
          <span className="font-medium">LP Auto Manager — WETH/USDC on Base</span>
          <span>·</span>
          <Address address={CONTRACT_ADDRESS} format="short" size="sm" />
        </div>
      </div>
    </div>
  );
};
