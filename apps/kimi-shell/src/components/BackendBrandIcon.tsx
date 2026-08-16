import type { ImgHTMLAttributes } from "react";

export type BackendBrand = "kimi" | "dsh";

type BackendBrandIconProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "children" | "src"> & {
  brand: BackendBrand;
  size?: number;
};

const BRAND_ASSETS: Record<BackendBrand, { src: string; label: string }> = {
  kimi: { src: "/kimi-code-icon.svg", label: "Kimi Code" },
  dsh: { src: "/deepseek-harness-icon.svg", label: "DeepSeek Harness" },
};

export function BackendBrandIcon({
  brand,
  size = 16,
  className = "",
  ...props
}: BackendBrandIconProps) {
  const asset = BRAND_ASSETS[brand];
  return (
    <img
      {...props}
      src={asset.src}
      width={size}
      height={size}
      className={`backend-brand-icon is-${brand}${className ? ` ${className}` : ""}`}
      alt=""
      aria-hidden="true"
      data-backend-brand={brand}
      title={asset.label}
    />
  );
}
