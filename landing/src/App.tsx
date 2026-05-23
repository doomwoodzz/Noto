import { Nav } from "./landing/Nav";
import { Hero } from "./landing/Hero";
import { AppPreview } from "./landing/AppPreview";
import { HowStrip } from "./landing/HowStrip";
import { Bento } from "./landing/Bento";
import { Quote } from "./landing/Quote";
import { FinalCTA } from "./landing/FinalCTA";
import { Footer } from "./landing/Footer";
import { useTheme } from "./landing/useTheme";

export default function App() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="l-page">
      <Nav theme={theme} setTheme={setTheme} />
      <Hero />
      <AppPreview />
      <HowStrip />
      <Bento />
      <Quote />
      <FinalCTA />
      <Footer />
    </div>
  );
}
