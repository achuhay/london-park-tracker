import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "@/pages/Home";
import Admin from "@/pages/Admin";
import NotFound from "@/pages/not-found";
import ReviewPage from "./pages/ReviewPage";
import Marathon from "@/pages/Marathon";
import Trophies from "@/pages/Trophies";
import Leaderboards from "@/pages/Leaderboards";
import CityPicker from "@/pages/CityPicker";
import { CelebrationToast } from "@/components/CelebrationToast";
import { CityProvider } from "@/contexts/CityContext";
import { useAuth } from "@/hooks/use-auth"; // Ensure Auth hook is available


function Router() {
  return (
    <Switch>
      <Route path="/" component={CityPicker} />
      <Route path="/london" component={Home} />
      <Route path="/edinburgh" component={Home} />
      <Route path="/london/admin" component={Admin} />
      <Route path="/edinburgh/admin" component={Admin} />
      <Route path="/london/marathon" component={Marathon} />
      <Route path="/edinburgh/marathon" component={Marathon} />
      <Route path="/london/trophies" component={Trophies} />
      <Route path="/edinburgh/trophies" component={Trophies} />
      <Route path="/london/leaderboards" component={Leaderboards} />
      <Route path="/edinburgh/leaderboards" component={Leaderboards} />
      <Route path="/review">
        <ReviewPage />
      </Route>
      {/*
        Note: Login/Logout handled by Replit Auth API routes directly:
        /api/login
        /api/logout
        We don't need client-side routes for them.
      */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <CityProvider>
          <Router />
          <Toaster />
          <CelebrationToast />
        </CityProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
