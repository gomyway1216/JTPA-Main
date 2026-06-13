import type { ProjectAsset } from "@/lib/types";

export function isProjectAsset(
  asset: Partial<ProjectAsset> | null | undefined,
): asset is ProjectAsset {
  return Boolean(asset?.path && asset.url);
}

export function validProjectAssets(
  assets: ProjectAsset[] | null | undefined,
): ProjectAsset[] {
  return (assets ?? []).filter(isProjectAsset);
}

export function projectAssetPathSet(
  assets: Array<Partial<ProjectAsset> | null | undefined>,
): Set<string> {
  return new Set(
    assets
      .map((asset) => asset?.path)
      .filter((path): path is string => Boolean(path)),
  );
}
