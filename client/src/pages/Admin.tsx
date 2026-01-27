import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useParks, useDeletePark } from "@/hooks/use-parks";
import { useLocation } from "wouter";
import { CsvImporter } from "@/components/CsvImporter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, Search, ArrowLeft, Loader2 } from "lucide-react";
import { useState } from "react";

export default function Admin() {
  const { user, isLoading: isLoadingAuth } = useAuth();
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  
  // Fetch all parks for admin view (no filters initially)
  const { data: parks = [], isLoading: isLoadingParks } = useParks({ search: searchTerm });
  const deletePark = useDeletePark();

  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoadingAuth && !user) {
      setLocation("/");
    }
  }, [user, isLoadingAuth, setLocation]);

  if (isLoadingAuth) {
    return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={() => setLocation("/")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold font-display tracking-tight">Admin Dashboard</h1>
              <p className="text-muted-foreground">Manage parks data and bulk imports.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Signed in as {user.firstName || user.email}</span>
            <Button variant="secondary" size="sm" asChild>
              <a href="/api/logout">Logout</a>
            </Button>
          </div>
        </div>

        {/* Tools Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-4">
            <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Search className="w-4 h-4 text-primary" />
                Search Database
              </h3>
              <Input 
                placeholder="Search by name, borough or type..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-background"
              />
            </div>
          </div>
          <div>
            <CsvImporter />
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex justify-between items-center">
            <h3 className="font-semibold">Parks Database ({parks.length})</h3>
          </div>
          
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Borough</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingParks ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                    </TableCell>
                  </TableRow>
                ) : parks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No parks found matching your criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  parks.map((park) => (
                    <TableRow key={park.id}>
                      <TableCell className="font-mono text-xs">{park.id}</TableCell>
                      <TableCell className="font-medium">{park.name}</TableCell>
                      <TableCell>{park.borough}</TableCell>
                      <TableCell>{park.siteType}</TableCell>
                      <TableCell>
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          park.openToPublic === 'Yes' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {park.openToPublic}
                        </span>
                      </TableCell>
                      <TableCell>
                        {park.completed ? (
                          <span className="text-primary font-bold text-xs">COMPLETED</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">PENDING</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            if(confirm(`Delete ${park.name}?`)) {
                              deletePark.mutate(park.id);
                            }
                          }}
                          disabled={deletePark.isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
