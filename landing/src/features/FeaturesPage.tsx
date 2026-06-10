import { Nav } from "../landing/Nav";
import { Footer } from "../landing/Footer";
import { HowStrip } from "../landing/HowStrip";
import { Quote } from "../landing/Quote";
import { AppPreview } from "../landing/AppPreview";
import { useTheme } from "../landing/useTheme";
import { FeaturesHero } from "./FeaturesHero";
import { FeatureOverview } from "./FeatureOverview";
import { FeatureDeepDive } from "./FeatureDeepDive";
import { PrivacyStrip } from "./PrivacyStrip";
import { WorkspaceEssentials } from "./WorkspaceEssentials";
import { CompareStrip } from "./CompareStrip";
import { ShortcutsTable } from "./ShortcutsTable";
import { PlatformGrid } from "./PlatformGrid";
import { FeaturesCTA } from "./FeaturesCTA";

export function FeaturesPage() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="l-page">
      <Nav theme={theme} setTheme={setTheme} />
      <FeaturesHero />
      <FeatureOverview />
      <FeatureDeepDive />
      <PrivacyStrip />
      <WorkspaceEssentials />
      <AppPreview />
      <CompareStrip />
      <ShortcutsTable />
      <PlatformGrid />
      <HowStrip />
      <Quote />
      <FeaturesCTA />
      <Footer />
    </div>
  );
}
